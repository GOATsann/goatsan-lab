// The deterministic game core. Pure logic: no rendering, no clock, no Math.random, no DOM.
// The browser, the headless runner and (later) the RL batch server all run this same code.
//
// One call to step(actions) = 1/60 s. Axes: x east, y up, z south; yaw 0 looks north (-z), positive yaw turns left.

import * as C from "./config";
import { type Action, quantize } from "./actions";
import { CHARACTERS, type AbilityKind } from "./characters";
import { atan2, clamp, cos, sin, wrap } from "./fmath";
import { getMap, type MapDef, type MapId } from "./maps";
import { Rng } from "./rng";
import { slab, World, HIT_NONE } from "./world";

export const VERSION = 1; // bump when the rules change: old replays no longer match

export type Mode = "duel" | "ffa" | "team";
export const MODES: Record<Mode, { label: string; teams: number[] }> = {
  duel: { label: "1v1", teams: [0, 1] },
  ffa: { label: "1 vs 3 free-for-all", teams: [0, 1, 2, 3] },
  team: { label: "2v2", teams: [0, 0, 1, 1] },
};

/** Rule switches. They are part of every replay. */
export interface GameOptions {
  map: MapId;
  mode: Mode;
  /** first team (in FFA: player) to this many eliminations wins */
  scoreLimit: number;
  regen: boolean;
  /** max turn per tick (radians) per agent; humans ~unlimited, bots and the AI lower */
  turnCaps: number[];
  /** 0 = no limit. A training-only cut-off (truncation, not a loss). */
  maxTicks: number;
  /** character per agent (index into CHARACTERS): decides the one ability */
  characters: number[];
}

export const defaultOptions = (o: Partial<GameOptions> = {}): GameOptions => {
  const mode = o.mode ?? "duel";
  const n = MODES[mode].teams.length;
  return {
    map: o.map ?? "base", mode, scoreLimit: o.scoreLimit ?? C.DEFAULT_SCORE_LIMIT, regen: o.regen ?? true,
    turnCaps: o.turnCaps ?? Array(n).fill(C.HUMAN_TURN_CAP), maxTicks: o.maxTicks ?? 0,
    characters: o.characters ?? Array.from({ length: n }, (_, i) => i % CHARACTERS.length),
  };
};

export interface Agent {
  id: number;
  team: number;
  character: number;
  ability: AbilityKind;
  /** ticks until the ability can be used again */
  abilityCooldown: number;
  /** ticks the ability stays active (dash, shield, cloak; the scan pulse) */
  abilityTicks: number;
  dashX: number; dashZ: number;
  /** scanFor[team] > 0: revealed to that team by a scan */
  scanFor: number[];
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  grounded: boolean;
  crouch: boolean;
  alive: boolean;
  health: number;
  ammo: number;
  reloadTicks: number;
  fireCooldown: number;
  respawnTicks: number;
  protectTicks: number;
  // reveal rules
  idleTicks: number;
  revealTicks: number;
  pingTicks: number; pingX: number; pingZ: number;
  /** outlineFor[v] > 0: this agent is outlined for viewer v (v hit it recently) */
  outlineFor: number[];
  // last time this agent was hurt, and from where (for the damage-direction indicator)
  lastDamageTick: number;
  dmgFromX: number; dmgFromZ: number;
  // stats
  kills: number; deaths: number; shots: number; hits: number; headshots: number; damageDealt: number;
}

export type Part = C.Part;
/** Surface label for an energy shield (after the map's wall 1, cover 2, floor 3). */
export const SURF_SHIELD = 4;
interface Shot { a: Agent; target: number; part: Part | null; t: number; dx: number; dy: number; dz: number; ox: number; oy: number; oz: number; surface: number; shield: number }

export type GameEvent =
  | { type: "shot"; a: number; ox: number; oy: number; oz: number; x: number; y: number; z: number; target: number; part: Part | null; surface: number }
  | { type: "hit"; a: number; v: number; part: Part; dmg: number; x: number; y: number; z: number; kill: boolean; blocked: boolean }
  | { type: "kill"; a: number; v: number; part: Part }
  | { type: "spawn"; a: number }
  | { type: "reload"; a: number }
  | { type: "jump"; a: number }
  | { type: "reveal"; a: number }
  | { type: "ability"; a: number; kind: AbilityKind }
  | { type: "blocked"; a: number; v: number; x: number; y: number; z: number }
  | { type: "end"; team: number };

/** Per-agent counts for one step. The batch server turns these into the RL reward (like runner/). */
export interface StepStats {
  damageDealt: number; damageTaken: number; hits: number; headshots: number; shots: number;
  kills: number; deaths: number; teamKills: number; teamDeaths: number; abilities: number; shieldBlocks: number;
}
export const STAT_FIELDS: (keyof StepStats)[] = ["damageDealt", "damageTaken", "hits", "headshots", "shots", "kills", "deaths", "teamKills", "teamDeaths", "abilities", "shieldBlocks"];
const emptyStats = (): StepStats => ({ damageDealt: 0, damageTaken: 0, hits: 0, headshots: 0, shots: 0, kills: 0, deaths: 0, teamKills: 0, teamDeaths: 0, abilities: 0, shieldBlocks: 0 });

export interface Hitboxes { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; part: Part }

const PART_IDX: Record<Part, number> = { head: 0, torso: 1, legs: 2 };

export class Game {
  readonly seed: number;
  readonly options: GameOptions;
  readonly map: MapDef;
  readonly world: World;
  readonly agents: Agent[];
  readonly teamScore: number[];
  private rng: Rng;
  tick = 0;
  over = false;
  truncated = false;
  winnerTeam = -1;
  events: GameEvent[] = [];
  stats: StepStats[];

  constructor(seed: number, options: Partial<GameOptions> = {}) {
    this.seed = seed >>> 0;
    this.options = defaultOptions(options);
    this.map = getMap(this.options.map);
    this.world = new World(this.map);
    this.rng = new Rng(this.seed ^ 0x5eed);
    const teams = MODES[this.options.mode].teams;
    const n = teams.length;
    this.teamScore = Array(Math.max(...teams) + 1).fill(0);
    const nTeams = Math.max(...teams) + 1;
    this.agents = teams.map((team, id) => ({
      id, team, character: this.options.characters[id] ?? 0, ability: CHARACTERS[this.options.characters[id] ?? 0].ability,
      abilityCooldown: 0, abilityTicks: 0, dashX: 0, dashZ: 0, scanFor: Array(nTeams).fill(0),
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, grounded: true, crouch: false, alive: false,
      health: C.MAX_HEALTH, ammo: C.CLIP, reloadTicks: 0, fireCooldown: 0, respawnTicks: 0, protectTicks: 0,
      idleTicks: 0, revealTicks: 0, pingTicks: 0, pingX: 0, pingZ: 0, outlineFor: Array(n).fill(0),
      lastDamageTick: -99999, dmgFromX: 0, dmgFromZ: 0,
      kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, damageDealt: 0,
    }));
    this.stats = this.agents.map(emptyStats);
    for (const a of this.agents) this.spawn(a);
  }

  get n(): number { return this.agents.length; }
  isEnemy(a: number, b: number): boolean { return this.agents[a].team !== this.agents[b].team; }
  height(a: Agent): number { return a.crouch ? C.CROUCH_H : C.STAND_H; }
  eyeY(a: Agent): number { return a.y + (a.crouch ? C.EYE_CROUCH : C.EYE_STAND); }

  /** The three hitboxes of an agent right now (head, torso, legs). */
  hitboxes(a: Agent, out: Hitboxes[] = [mkHb("head"), mkHb("torso"), mkHb("legs")]): Hitboxes[] {
    const s = a.crouch ? C.CROUCH_H / C.STAND_H : 1;
    for (const hb of out) {
      const d = C.HITBOX[hb.part];
      hb.x0 = a.x - d.hw; hb.x1 = a.x + d.hw; hb.z0 = a.z - d.hw; hb.z1 = a.z + d.hw;
      hb.y0 = a.y + d.y0 * s; hb.y1 = a.y + d.y1 * s;
    }
    return out;
  }

  // ------------------------------------------------------------------------------------- step
  step(actions: readonly Action[]): void {
    if (this.over) return;
    this.events = [];
    for (const s of this.stats) Object.assign(s, emptyStats());
    const agents = this.agents;

    // 1. timers, respawns
    for (const a of agents) {
      if (a.pingTicks > 0) a.pingTicks--;
      if (a.revealTicks > 0) a.revealTicks--;
      for (let v = 0; v < a.outlineFor.length; v++) if (a.outlineFor[v] > 0) a.outlineFor[v]--;
      for (let t = 0; t < a.scanFor.length; t++) if (a.scanFor[t] > 0) a.scanFor[t]--;
      if (a.abilityCooldown > 0) a.abilityCooldown--;
      if (a.abilityTicks > 0) a.abilityTicks--;
      if (!a.alive) {
        if (--a.respawnTicks <= 0) this.spawn(a);
        continue;
      }
      if (a.protectTicks > 0) a.protectTicks--;
      if (a.fireCooldown > 0) a.fireCooldown--;
      if (a.reloadTicks > 0 && --a.reloadTicks === 0) a.ammo = C.CLIP;
    }

    // 2. aim and move
    const moved: boolean[] = [];
    for (const a of agents) {
      moved.push(false);
      if (!a.alive) continue;
      const act = actions[a.id];
      const cap = this.options.turnCaps[a.id] ?? C.HUMAN_TURN_CAP;
      a.yaw = wrapYaw(a.yaw + clamp(quantize(act.yaw), -cap, cap));
      a.pitch = clamp(a.pitch + clamp(quantize(act.pitch), -cap, cap), -1.45, 1.45);
      if (act.ability && a.abilityCooldown === 0) this.useAbility(a, act);
      const ox = a.x, oz = a.z;
      this.move(a, act);
      const dx = a.x - ox, dz = a.z - oz;
      moved[a.id] = dx * dx + dz * dz > C.IDLE_MOVE_EPS * C.IDLE_MOVE_EPS;
    }

    // 3. reload and fire: every shot is traced against positions after movement, then all damage is
    //    applied at once (two robots can trade eliminations in the same tick; id order gives no edge)
    const shots: Shot[] = [];
    const fired: boolean[] = agents.map(() => false);
    for (const a of agents) {
      if (!a.alive) continue;
      const act = actions[a.id];
      if (act.reload && a.reloadTicks === 0 && a.ammo < C.CLIP) this.startReload(a);
      if (!act.fire || a.fireCooldown > 0 || a.reloadTicks > 0) continue;
      if (a.ammo <= 0) { this.startReload(a); continue; }
      a.ammo--; a.fireCooldown = C.FIRE_TICKS; a.shots++; this.stats[a.id].shots++;
      a.protectTicks = 0; // firing ends spawn protection
      if (a.ability === "cloak") a.abilityTicks = 0; // and breaks a cloak
      a.pingTicks = C.PING_TICKS; a.pingX = a.x; a.pingZ = a.z;
      fired[a.id] = true;
      // spread: still < moving < airborne; crouching tightens it
      const hs = Math.sqrt(a.vx * a.vx + a.vz * a.vz) / C.RUN_SPEED;
      let spread = C.SPREAD_BASE + C.SPREAD_MOVE * Math.min(1, hs) + (a.grounded ? 0 : C.SPREAD_AIR);
      if (a.crouch) spread *= C.SPREAD_CROUCH_MULT;
      const yaw = a.yaw + this.rng.gauss() * spread * 0.5, pitch = a.pitch + this.rng.gauss() * spread * 0.5;
      const cp = cos(pitch);
      const dx = -sin(yaw) * cp, dy = sin(pitch), dz = -cos(yaw) * cp;
      const ox = a.x, oy = this.eyeY(a), oz = a.z;
      const hit = this.trace(a.id, ox, oy, oz, dx, dy, dz, C.RANGE);
      shots.push({ a, target: hit.agent, part: hit.part, t: hit.t, dx, dy, dz, ox, oy, oz, surface: hit.surface, shield: hit.shield });
    }
    if (shots.length) this.applyShots(shots);

    // 4. idle reveal, regen
    for (const a of agents) {
      if (!a.alive) continue;
      if (moved[a.id] || fired[a.id]) a.idleTicks = 0;
      else if (++a.idleTicks >= C.IDLE_REVEAL_AFTER) {
        a.idleTicks = 0;
        a.revealTicks = C.IDLE_REVEAL_TICKS;
        this.events.push({ type: "reveal", a: a.id });
      }
      if (this.options.regen && a.health < C.MAX_HEALTH && this.tick - a.lastDamageTick >= C.REGEN_DELAY_TICKS) {
        a.health = Math.min(C.MAX_HEALTH, a.health + C.REGEN_PER_TICK);
      }
    }

    this.tick++;
    if (!this.over && this.options.maxTicks > 0 && this.tick >= this.options.maxTicks) { this.over = true; this.truncated = true; }
  }

  private startReload(a: Agent): void {
    if (a.reloadTicks > 0 || a.ammo >= C.CLIP) return;
    a.reloadTicks = C.RELOAD_TICKS;
    this.events.push({ type: "reload", a: a.id });
  }

  private applyShots(shots: Shot[]): void {
    const dying: { v: Agent; by: Agent; part: Part }[] = [];
    for (const s of shots) {
      const x = s.ox + s.dx * s.t, y = s.oy + s.dy * s.t, z = s.oz + s.dz * s.t;
      this.events.push({ type: "shot", a: s.a.id, ox: s.ox, oy: s.oy, oz: s.oz, x, y, z, target: s.target, part: s.part, surface: s.surface });
      if (s.surface === SURF_SHIELD && s.shield >= 0) {
        this.stats[s.shield].shieldBlocks++;
        this.events.push({ type: "blocked", a: s.a.id, v: s.shield, x, y, z });
      }
      if (s.target < 0 || !s.part) continue;
      const v = this.agents[s.target];
      if (!this.isEnemy(s.a.id, v.id)) continue; // friendly fire is off: a teammate blocks the shot, no damage
      const blocked = v.protectTicks > 0;
      const dmg = blocked ? 0 : C.BASE_DAMAGE * C.PART_MULT[s.part];
      s.a.hits++; this.stats[s.a.id].hits++;
      if (s.part === "head") { s.a.headshots++; this.stats[s.a.id].headshots++; }
      v.outlineFor[s.a.id] = C.OUTLINE_TICKS; // you see who you hit, even behind cover
      const wasAlive = v.health > 0;
      if (dmg > 0) {
        v.health -= dmg;
        v.lastDamageTick = this.tick;
        v.dmgFromX = s.a.x; v.dmgFromZ = s.a.z;
        s.a.damageDealt += dmg;
        this.stats[s.a.id].damageDealt += dmg;
        this.stats[v.id].damageTaken += dmg;
      }
      const kill = wasAlive && v.health <= 0;
      this.events.push({ type: "hit", a: s.a.id, v: v.id, part: s.part, dmg, x, y, z, kill, blocked });
      if (kill) dying.push({ v, by: s.a, part: s.part });
    }
    for (const d of dying) this.eliminate(d.v, d.by, d.part);
  }

  private eliminate(v: Agent, by: Agent, part: Part): void {
    v.alive = false; v.health = 0; v.deaths++; v.respawnTicks = C.RESPAWN_TICKS;
    v.vx = v.vy = v.vz = 0; v.reloadTicks = 0;
    by.kills++;
    this.teamScore[by.team]++;
    this.stats[by.id].kills++;
    this.stats[v.id].deaths++;
    for (const a of this.agents) {
      if (a.team === by.team) this.stats[a.id].teamKills++;
      if (a.team === v.team) this.stats[a.id].teamDeaths++;
    }
    this.events.push({ type: "kill", a: by.id, v: v.id, part });
    if (!this.over && this.teamScore[by.team] >= this.options.scoreLimit) {
      this.over = true;
      this.winnerTeam = by.team;
      this.events.push({ type: "end", team: by.team });
    }
  }

  /**
   * Trace a ray from (ox, oy, oz) along a unit direction: nearest of the map, every other living robot and
   * every enemy energy shield. Returns the distance, the robot and body part hit (or -1 / null), the surface
   * label for non-robot hits (wall, cover, floor, SURF_SHIELD) and whose shield it was.
   * eyes = true: trace for perception (the AI's rays): cloaked enemies farther than CLOAK_SEE_DIST are see-through.
   */
  trace(self: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, eyes = false): { t: number; agent: number; part: Part | null; surface: number; shield: number } {
    let t = this.world.raycast(ox, oy, oz, dx, dy, dz, range);
    let surface = this.world.hitKind;
    let agent = -1, part: Part | null = null, shield = -1;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const team = self >= 0 ? this.agents[self].team : -1;
    for (const b of this.agents) {
      if (b.id === self || !b.alive) continue;
      if (eyes && b.team !== team && this.cloaked(b)) {
        const ddx = b.x - ox, ddz = b.z - oz;
        if (ddx * ddx + ddz * ddz > C.CLOAK_SEE_DIST * C.CLOAK_SEE_DIST) continue;
      }
      // an enemy's shield: a rectangle in front of it, facing where it looks; stops lasers from the front
      if (b.ability === "shield" && b.abilityTicks > 0 && b.team !== team) {
        const nx = -sin(b.yaw), nz = -cos(b.yaw);
        const den = dx * nx + dz * nz;
        if (den < 0) {
          const cx = b.x + nx * C.SHIELD_FORWARD, cyy = b.y + C.SHIELD_HALF_H, cz = b.z + nz * C.SHIELD_FORWARD;
          const st = ((cx - ox) * nx + (cz - oz) * nz) / den;
          if (st > 0 && st < t) {
            const px = ox + dx * st - cx, py = oy + dy * st - cyy, pz = oz + dz * st - cz;
            const u = px * -nz + pz * nx; // along the shield's width
            if (u <= C.SHIELD_HALF_W && u >= -C.SHIELD_HALF_W && py <= C.SHIELD_HALF_H && py >= -C.SHIELD_HALF_H) {
              t = st; agent = -1; part = null; surface = SURF_SHIELD; shield = b.id;
            }
          }
        }
      }
      // quick reject: the whole body box
      const h = this.height(b);
      if (slab(ox, oy, oz, ix, iy, iz, b.x - 0.3, b.y, b.z - 0.3, b.x + 0.3, b.y + h, b.z + 0.3, t) === Infinity) continue;
      for (const hb of this.hitboxes(b, HB_SCRATCH)) {
        const ht = slab(ox, oy, oz, ix, iy, iz, hb.x0, hb.y0, hb.z0, hb.x1, hb.y1, hb.z1, t);
        if (ht < t || (ht === t && agent === b.id && PART_IDX[hb.part] < PART_IDX[part!])) { t = ht; agent = b.id; part = hb.part; shield = -1; }
      }
    }
    return { t, agent, part, surface: agent >= 0 ? HIT_NONE : surface, shield };
  }

  cloaked(a: Agent): boolean { return a.ability === "cloak" && a.abilityTicks > 0; }

  // ---------------------------------------------------------------------------------- abilities
  private useAbility(a: Agent, act: Action): void {
    a.abilityCooldown = CHARACTERS[a.character].cooldown;
    this.stats[a.id].abilities++;
    this.events.push({ type: "ability", a: a.id, kind: a.ability });
    switch (a.ability) {
      case "dash": {
        // burst along the wished direction (forward if standing still)
        const sy = sin(a.yaw), cy = cos(a.yaw);
        let f = act.forward, s = act.strafe;
        if (f === 0 && s === 0) f = 1;
        let wx = -f * sy + s * cy, wz = -f * cy - s * sy;
        const l = Math.sqrt(wx * wx + wz * wz);
        wx /= l; wz /= l;
        a.dashX = wx * C.DASH_SPEED; a.dashZ = wz * C.DASH_SPEED;
        a.abilityTicks = C.DASH_TICKS;
        break;
      }
      case "shield": a.abilityTicks = C.SHIELD_TICKS; break;
      case "cloak": a.abilityTicks = C.CLOAK_TICKS; break;
      case "scan": {
        a.abilityTicks = C.SCAN_PULSE_TICKS;
        for (const b of this.agents) {
          if (!b.alive || b.team === a.team) continue;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          if (dx * dx + dy * dy + dz * dz <= C.SCAN_RANGE * C.SCAN_RANGE) b.scanFor[a.team] = C.SCAN_REVEAL_TICKS;
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------------- movement
  private move(a: Agent, act: Action): void {
    const R = C.RADIUS;
    // crouch: stand up only if there is room
    if (act.crouch) a.crouch = true;
    else if (a.crouch && this.world.overlap(a.x - R, a.y, a.z - R, a.x + R, a.y + C.STAND_H, a.z + R) < 0) a.crouch = false;
    const h = this.height(a);
    const sy = sin(a.yaw), cy = cos(a.yaw);
    // forward = (-sy, -cy), right = (cy, -sy)
    let wx = -act.forward * sy + act.strafe * cy;
    let wz = -act.forward * cy - act.strafe * sy;
    const wl = Math.sqrt(wx * wx + wz * wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const speed = a.crouch ? C.CROUCH_SPEED : C.RUN_SPEED;
    const acc = (a.grounded ? C.GROUND_ACCEL : C.AIR_ACCEL) * C.DT;
    if (a.ability === "dash" && a.abilityTicks > 0) { a.vx = a.dashX; a.vz = a.dashZ; }
    else {
      a.vx += clamp(wx * speed - a.vx, -acc, acc);
      a.vz += clamp(wz * speed - a.vz, -acc, acc);
    }
    if (act.jump && a.grounded) {
      a.vy = C.JUMP_V; a.grounded = false;
      this.events.push({ type: "jump", a: a.id });
    }
    a.vy -= C.GRAVITY * C.DT;
    this.moveAxis(a, 0, a.vx * C.DT, h);
    this.moveAxis(a, 2, a.vz * C.DT, h);
    // vertical
    a.y += a.vy * C.DT;
    a.grounded = false;
    if (a.y <= 0) { a.y = 0; a.vy = 0; a.grounded = true; }
    for (let it = 0; it < 4; it++) {
      const i = this.world.overlap(a.x - R, a.y, a.z - R, a.x + R, a.y + h, a.z + R);
      if (i < 0) break;
      if (a.vy <= 0) { a.y = this.world.y1[i]; a.grounded = true; } else a.y = this.world.y0[i] - h;
      a.vy = 0;
    }
  }

  private moveAxis(a: Agent, axis: 0 | 2, d: number, h: number): void {
    if (d === 0) return;
    const R = C.RADIUS, W = this.world;
    if (axis === 0) a.x += d; else a.z += d;
    for (let it = 0; it < 4; it++) {
      const i = W.overlap(a.x - R, a.y, a.z - R, a.x + R, a.y + h, a.z + R);
      if (i < 0) return;
      // a low step: walk up onto it if there is room
      const top = W.y1[i];
      if (a.grounded && top > a.y && top - a.y <= C.STEP_UP && W.overlap(a.x - R, top, a.z - R, a.x + R, top + h, a.z + R) < 0) {
        a.y = top;
        continue;
      }
      if (axis === 0) { a.x = d > 0 ? W.x0[i] - R - 1e-6 : W.x1[i] + R + 1e-6; a.vx = 0; }
      else { a.z = d > 0 ? W.z0[i] - R - 1e-6 : W.z1[i] + R + 1e-6; a.vz = 0; }
    }
  }

  // ------------------------------------------------------------------------------------ spawning
  private spawn(a: Agent): void {
    // the spawn point farthest from living enemies (a little randomness so it is not predictable)
    let best = this.map.spawns[0], bestScore = -Infinity;
    for (const p of this.map.spawns) {
      let near = 1e9;
      for (const b of this.agents) {
        if (b.id === a.id || !b.alive) continue;
        const d = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
        // enemies push you away; standing right on top of a teammate is avoided too
        const w = b.team === a.team ? (d < 4 ? 0 : 1e9) : d;
        if (w < near) near = w;
      }
      const score = Math.sqrt(near) + this.rng.float() * 6;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    a.x = best.x; a.z = best.z; a.y = 0;
    a.vx = a.vy = a.vz = 0;
    a.yaw = yawTo(-best.x, -best.z); // face the middle of the map
    a.pitch = 0;
    a.grounded = true; a.crouch = false; a.alive = true;
    a.health = C.MAX_HEALTH; a.ammo = C.CLIP; a.reloadTicks = 0; a.fireCooldown = 0;
    a.protectTicks = C.PROTECT_TICKS; a.idleTicks = 0; a.revealTicks = 0;
    a.lastDamageTick = -99999;
    a.abilityCooldown = 0; a.abilityTicks = 0; // the ability is ready after a respawn
    this.events.push({ type: "spawn", a: a.id });
  }

  // ------------------------------------------------------------------------------------- hashing
  /** A hash of everything that matters: equal hashes = the same match state. */
  hash(): number {
    const f = new Float64Array(1), u = new Uint32Array(f.buffer);
    let h = 0x811c9dc5 ^ this.tick;
    const mix = (x: number) => {
      f[0] = x;
      h = Math.imul(h ^ u[0], 0x01000193) >>> 0;
      h = Math.imul(h ^ u[1], 0x01000193) >>> 0;
    };
    for (const a of this.agents) {
      mix(a.x); mix(a.y); mix(a.z); mix(a.vx); mix(a.vy); mix(a.vz); mix(a.yaw); mix(a.pitch);
      mix(a.health); mix(a.ammo); mix(a.kills); mix(a.deaths); mix(a.shots); mix(a.hits);
      mix(a.alive ? 1 : 0); mix(a.crouch ? 1 : 0); mix(a.idleTicks); mix(a.pingTicks); mix(a.abilityCooldown); mix(a.abilityTicks);
    }
    for (const s of this.teamScore) mix(s);
    for (const w of this.rng.s) h = Math.imul(h ^ w, 0x01000193) >>> 0;
    return h >>> 0;
  }
}

const mkHb = (part: Part): Hitboxes => ({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, part });
const HB_SCRATCH: Hitboxes[] = [mkHb("head"), mkHb("torso"), mkHb("legs")];

/** Yaw that looks along the world direction (dx, dz). */
export function yawTo(dx: number, dz: number): number {
  return atan2(-dx, -dz);
}
const wrapYaw = wrap;
