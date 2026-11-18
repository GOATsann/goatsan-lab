// Heuristic bots: the opponents (and 2v2 teammate) until the RL agent is trained, and later a sparring
// partner mixed into training. Deterministic (own seeded Rng) and FAIR: a bot only reads its Observation
// (labelled rays, minimap memory, own state) and the map layout a player knows too. It never reads the
// Game, so it cannot see through walls. It answers with the same Action a human or the RL agent uses.
//
// State machine: patrol -> (notice: sight, minimap ping, outline, damage) -> engage (aim with a reaction
// delay, capped turn speed and aim noise; head when close) -> cover when hurt -> reposition (hunt).
// In 2v2 it stays loosely near its teammate, picks the enemy closest to the teammate, and steps out of
// the teammate's line of fire.

import * as C from "./config";
import type { Action } from "./actions";
import { atan2, clamp, cos as cosApprox, sin as sinApprox, wrap } from "./fmath";
import { NavGrid } from "./nav";
import { L_HEAD, L_LEGS, L_MATE, L_TORSO, MEM_NONE, MEM_TEAMMATE, N_RAYS, RAY_PITCH, RAY_YAW, type Observation } from "./obs";
import { Rng } from "./rng";
import type { World } from "./world";

export type SkillName = "easy" | "normal" | "hard";
export const SKILL_NAMES: SkillName[] = ["easy", "normal", "hard"];

export interface BotSkill {
  /** ticks from first seeing an enemy until it starts aiming at it */
  reactionTicks: number;
  /** max turn per tick (radians) */
  turnPerTick: number;
  /** steady aim wobble (radians, sd) */
  aimNoise: number;
  /** extra error on the first shots at a new target (radians, sd), fades out */
  firstShotNoise: number;
  /** aims at the head when the enemy is closer than this (metres) */
  headDist: number;
  /** fires when the aim error is under (part half-size x this) */
  fireTol: number;
  /** chance to strafe while fighting */
  strafeChance: number;
  /** chance to crouch-fire at range */
  crouchFire: number;
  /** seeks cover below this health */
  coverHealth: number;
  /** 0..1: how well it leads a moving target */
  lead: number;
}

export const SKILLS: Record<SkillName, BotSkill> = {
  easy: { reactionTicks: 30, turnPerTick: 2.6 / 60, aimNoise: 0.03, firstShotNoise: 0.09, headDist: 0, fireTol: 1.7, strafeChance: 0.3, crouchFire: 0, coverHealth: 30, lead: 0 },
  normal: { reactionTicks: 17, turnPerTick: 5 / 60, aimNoise: 0.014, firstShotNoise: 0.055, headDist: 9, fireTol: 1.25, strafeChance: 0.75, crouchFire: 0.2, coverHealth: 40, lead: 0.5 },
  hard: { reactionTicks: 10, turnPerTick: 8.5 / 60, aimNoise: 0.007, firstShotNoise: 0.03, headDist: 22, fireTol: 1.0, strafeChance: 1, crouchFire: 0.35, coverHealth: 45, lead: 1 },
};

export type BotState = "patrol" | "hunt" | "engage" | "cover" | "regroup";

const D = C.DECISION_TICKS;
const PART_HALF = { head: [C.HITBOX.head.hw, (C.HITBOX.head.y1 - C.HITBOX.head.y0) / 2], torso: [C.HITBOX.torso.hw, (C.HITBOX.torso.y1 - C.HITBOX.torso.y0) / 2], legs: [C.HITBOX.legs.hw, (C.HITBOX.legs.y1 - C.HITBOX.legs.y0) / 2] } as const;
const yawTo = (dx: number, dz: number) => atan2(-dx, -dz);

interface Sighting { t: number; x: number; z: number }

export class HeuristicBot {
  readonly id: number;
  readonly skill: BotSkill;
  readonly skillName: SkillName;
  private rng: Rng;
  private world: World;
  private nav: NavGrid;

  state: BotState = "patrol";
  target = -1;
  private t = 0;
  private lastSeen: (Sighting | null)[] = Array(C.MAX_AGENTS).fill(null);
  private visibleLast: boolean[] = Array(C.MAX_AGENTS).fill(false);
  // path following
  private path: number[] = [];
  private pathIdx = 0;
  private goalX = 0; private goalZ = 0;
  private goalUntil = 0;
  // aim
  private reactUntil = 0;
  private noiseY = 0; private noiseP = 0; private fsY = 0; private fsP = 0;
  private prevTargetYaw = NaN;
  // movement in a fight
  private strafeDir = 0; private strafeUntil = 0; private crouchFiring = false;
  private lastX = 0; private lastZ = 0;
  // cover
  private coverX = 0; private coverZ = 0; private coverUntil = 0; private coverCooldown = 0; private inCover = false;
  // alert look (damage from somewhere / sound)
  private lookYawW = 0; private lookUntil = 0;
  // stuck detection
  private stuckX = 0; private stuckZ = 0; private stuckCheck = 0;

  // perception scratch
  private vis = new Uint8Array(C.MAX_AGENTS);
  private minDist = new Float32Array(C.MAX_AGENTS);
  private minRay = new Int16Array(C.MAX_AGENTS);
  private partN = new Int16Array(C.MAX_AGENTS * 3);
  private partY = new Float64Array(C.MAX_AGENTS * 3);
  private partP = new Float64Array(C.MAX_AGENTS * 3);
  private mateInSights = false;
  private lastAnySeen = 0;

  constructor(id: number, skill: SkillName, seed: number, world: World, nav: NavGrid) {
    this.id = id;
    this.skillName = skill;
    this.skill = SKILLS[skill];
    this.rng = new Rng((seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0);
    this.world = world;
    this.nav = nav;
  }

  /** Called every DECISION_TICKS ticks. Writes a per-tick action into `out` (held for D ticks). */
  decide(o: Observation, out: Action): void {
    this.t = o.tick;
    out.forward = 0; out.strafe = 0; out.jump = false; out.crouch = false; out.yaw = 0; out.pitch = 0; out.fire = false; out.reload = false; out.ability = false;
    if (!o.alive) {
      this.state = "patrol"; this.target = -1; this.path = []; this.inCover = false;
      this.visibleLast.fill(false);
      return;
    }
    this.perceive(o);
    const mate = this.mateId(o);

    // ---- pick a target among visible enemies (in 2v2: favour the one nearest the teammate)
    let tgt = -1;
    if (this.target >= 0 && this.vis[this.target]) tgt = this.target;
    else {
      let best = Infinity;
      for (let j = 0; j < o.n; j++) {
        if (!this.vis[j]) continue;
        let s = this.minDist[j];
        if (mate >= 0) {
          const ls = this.lastSeen[j]!;
          s += 0.6 * Math.sqrt((ls.x - o.memX[mate]) ** 2 + (ls.z - o.memZ[mate]) ** 2);
        }
        if (s < best) { best = s; tgt = j; }
      }
    }
    if (tgt >= 0 && (tgt !== this.target || !this.visibleLast[tgt])) {
      // a new sighting: human-like reaction time before aiming, and a shaky first shot
      this.reactUntil = this.t + Math.round(this.skill.reactionTicks * this.rng.range(0.8, 1.25));
      this.fsY = this.rng.gauss() * this.skill.firstShotNoise;
      this.fsP = this.rng.gauss() * this.skill.firstShotNoise * 0.6;
      this.prevTargetYaw = NaN;
      this.crouchFiring = this.rng.float() < this.skill.crouchFire && this.minDist[tgt] > 12;
    }
    if (tgt >= 0) this.target = tgt;
    for (let j = 0; j < C.MAX_AGENTS; j++) this.visibleLast[j] = this.vis[j] === 1;

    // ---- state transitions
    const seesTarget = tgt >= 0;
    if (this.state === "cover") {
      const done = this.inCover && (o.health >= 85 || this.t >= this.coverUntil);
      if (done) { this.coverCooldown = this.t + 10 * C.TICK_HZ; this.inCover = false; this.startHunt(o, true); }
    } else if (seesTarget) {
      if (o.health < this.skill.coverHealth && this.t >= this.coverCooldown && this.planCover(o, tgt)) this.state = "cover";
      else this.state = "engage";
    } else if (this.state === "engage") {
      this.startHunt(o, false); // lost sight: go to where it was last seen
    }
    // noticing without sight: minimap pings, hit outlines, idle reveals
    if (this.state === "patrol" || this.state === "hunt" || this.state === "regroup") {
      const k = this.nearestKnownEnemy(o);
      if (k >= 0) {
        const dx = o.memX[k] - this.goalX, dz = o.memZ[k] - this.goalZ;
        if (this.state !== "hunt" || dx * dx + dz * dz > 9) this.setGoal(o, o.memX[k], o.memZ[k], 8 * C.TICK_HZ);
        this.state = "hunt";
        this.lookYawW = yawTo(o.memX[k] - o.x, o.memZ[k] - o.z);
        this.lookUntil = this.t + D;
      }
    }
    if (!seesTarget && o.dmgAge < 2 * D) {
      // hit by something unseen: turn toward the damage indicator
      this.lookYawW = wrap(o.yaw + o.dmgYaw);
      this.lookUntil = this.t + 45;
    }

    // ---- act
    switch (this.state) {
      case "engage": this.engage(o, out, mate); break;
      case "cover": this.cover(o, out, seesTarget); break;
      case "hunt": this.travel(o, out, 0.6); if (!this.path.length || this.t > this.goalUntil) this.state = "patrol"; break;
      case "regroup":
      case "patrol": this.patrol(o, out, mate); break;
    }
    if (o.ammo < C.CLIP * 0.35 && !seesTarget && o.reloadTicks === 0) out.reload = true;
    if (seesTarget) this.lastAnySeen = this.t;
    this.useAbility(o, out, seesTarget);
    this.lastX = o.x; this.lastZ = o.z;
  }

  // ---------------------------------------------------------------------------------- abilities
  /** Simple rules per ability: dash out of trouble, shield up in a losing fight, scan when lost, cloak to flank. */
  private useAbility(o: Observation, out: Action, seesTarget: boolean): void {
    if (o.abilityCooldown > 0) return;
    const hurtNow = o.dmgAge < 2 * D;
    switch (o.ability) {
      case "dash":
        if ((hurtNow && o.health < 70) || (this.state === "cover" && !this.inCover && this.path.length > 0)) {
          if (out.forward === 0 && out.strafe === 0) out.strafe = this.rng.float() < 0.5 ? -1 : 1;
          out.ability = true;
        }
        break;
      case "shield":
        if (seesTarget && this.state === "engage" && (o.health < 60 || (hurtNow && this.minDist[this.target] < 12))) out.ability = true;
        break;
      case "scan":
        if (!seesTarget && this.t - this.lastAnySeen > 4 * C.TICK_HZ && this.nearestKnownEnemy(o) < 0 && this.rng.float() < 0.3) out.ability = true;
        break;
      case "cloak":
        if (!seesTarget && this.state === "hunt" && this.path.length > 6) out.ability = true;
        break;
    }
  }

  // ---------------------------------------------------------------------------------- perception
  private perceive(o: Observation): void {
    this.vis.fill(0); this.minDist.fill(Infinity); this.partN.fill(0); this.partY.fill(0); this.partP.fill(0);
    this.mateInSights = false;
    for (let k = 0; k < N_RAYS; k++) {
      const lab = o.label[k];
      if (lab === L_MATE) {
        if (Math.abs(RAY_YAW[k]) < 0.03 && Math.abs(RAY_PITCH[k]) < 0.03) this.mateInSights = true;
        continue;
      }
      if (lab < L_HEAD || lab > L_LEGS) continue;
      const j = o.agent[k];
      this.vis[j] = 1;
      const p = j * 3 + (lab - L_HEAD);
      this.partN[p]++; this.partY[p] += RAY_YAW[k]; this.partP[p] += RAY_PITCH[k];
      if (o.dist[k] < this.minDist[j]) { this.minDist[j] = o.dist[k]; this.minRay[j] = k; }
    }
    // remember where each visible enemy is (estimated from the nearest ray that hit it)
    for (let j = 0; j < o.n; j++) {
      if (!this.vis[j]) continue;
      const k = this.minRay[j], d = this.minDist[j];
      const yw = o.yaw + RAY_YAW[k], pw = o.pitch + RAY_PITCH[k];
      // horizontal distance ~ d * cos(pitch); small-angle safe approximation without trig
      const hd = d * (1 - (pw * pw) / 2);
      this.lastSeen[j] = { t: this.t, x: o.x - hd * sinApprox(yw), z: o.z - hd * cosApprox(yw) };
    }
  }

  private mateId(o: Observation): number {
    for (let j = 0; j < o.n; j++) if (o.isMate[j] && o.memSource[j] === MEM_TEAMMATE) return j;
    return -1;
  }

  private nearestKnownEnemy(o: Observation): number {
    let best = -1, bd = Infinity;
    for (let j = 0; j < o.n; j++) {
      if (j === o.id || o.isMate[j] || o.memSource[j] === MEM_NONE) continue;
      const d = (o.memX[j] - o.x) ** 2 + (o.memZ[j] - o.z) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------- behaviours
  private engage(o: Observation, out: Action, mate: number): void {
    const j = this.target;
    const dist = this.minDist[j];
    // which part to aim at: head when close enough (skill), else the biggest visible part
    const n = (p: number) => this.partN[j * 3 + p];
    let part = 1; // torso
    if (n(0) > 0 && dist < this.skill.headDist) part = 0;
    else if (n(1) === 0) part = n(0) > 0 ? 0 : 2;
    const pi = j * 3 + part;
    const errY = this.partY[pi] / this.partN[pi], errP = this.partP[pi] / this.partN[pi];

    if (this.t < this.reactUntil) {
      // still reacting: keep moving, drift the view a little toward it
      this.aim(o, out, errY * 0.15, errP * 0.15);
      return this.fightMove(o, out, dist, mate, false);
    }
    // lead a moving target (hitscan, so this only makes up for the turn/decision lag)
    const yawW = o.yaw + errY;
    let lead = 0;
    if (!Number.isNaN(this.prevTargetYaw)) lead = clamp(wrap(yawW - this.prevTargetYaw), -0.2, 0.2) * this.skill.lead * 0.8;
    this.prevTargetYaw = yawW;
    // wobble: smooth random walk + first-shot error that fades
    this.noiseY = this.noiseY * 0.75 + this.rng.gauss() * this.skill.aimNoise * 0.66;
    this.noiseP = this.noiseP * 0.75 + this.rng.gauss() * this.skill.aimNoise * 0.5;
    this.fsY *= 0.72; this.fsP *= 0.72;
    const wantY = errY + lead + this.noiseY + this.fsY, wantP = errP + this.noiseP + this.fsP;
    this.aim(o, out, wantY, wantP);
    // fire when it believes the crosshair is on the part (after this tick's turn)
    const name = part === 0 ? "head" : part === 1 ? "torso" : "legs";
    const [hw, hh] = PART_HALF[name];
    const tolY = Math.max(0.004, (hw / dist) * this.skill.fireTol), tolP = Math.max(0.004, (hh / dist) * this.skill.fireTol);
    const resY = wantY - out.yaw, resP = wantP - out.pitch;
    const holdForCloak = o.ability === "cloak" && o.abilityTicks > 0 && dist > 10;
    if (Math.abs(resY) < tolY && Math.abs(resP) < tolP && o.ammo > 0 && o.reloadTicks === 0 && !this.mateInSights && !holdForCloak) out.fire = true;
    if (o.ammo === 0) out.reload = true;
    this.fightMove(o, out, dist, mate, out.fire);
  }

  private fightMove(o: Observation, out: Action, dist: number, mate: number, firing: boolean): void {
    if (this.crouchFiring && firing) { out.crouch = true; return; }
    // strafe, switching direction at random moments; bounce off walls
    const movedSq = (o.x - this.lastX) ** 2 + (o.z - this.lastZ) ** 2;
    if (this.strafeDir !== 0 && movedSq < 0.0004) this.strafeDir = -this.strafeDir;
    if (this.t >= this.strafeUntil) {
      this.strafeDir = this.rng.float() < this.skill.strafeChance ? (this.rng.float() < 0.5 ? -1 : 1) : 0;
      this.strafeUntil = this.t + Math.round(this.rng.range(24, 75));
    }
    out.strafe = this.strafeDir;
    if (dist > 22) out.forward = 1;
    else if (dist < 5 && this.skillName === "hard") out.forward = -1;
    // 2v2: don't stand in the teammate's line of fire
    if (mate >= 0 && this.target >= 0 && this.lastSeen[this.target]) {
      const s = this.lastSeen[this.target]!;
      const ax = o.memX[mate], az = o.memZ[mate];
      const vx = s.x - ax, vz = s.z - az, wx = o.x - ax, wz = o.z - az;
      const len2 = vx * vx + vz * vz;
      const u = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
      if (u > 0 && u < 1) {
        const cross = vx * wz - vz * wx;
        const perp = Math.abs(cross) / Math.sqrt(len2);
        if (perp < 1.3) {
          // move sideways away from the line: pick the strafe that increases the distance
          out.strafe = this.sideAway(o, vx, vz, cross);
          out.forward = 0;
        }
      }
    }
    if (this.skillName === "hard" && out.strafe !== 0 && o.grounded && this.rng.float() < 0.015) out.jump = true;
  }

  /** Strafe direction (-1/1) that moves away from the line with direction (vx, vz); `cross` says which side we are on. */
  private sideAway(o: Observation, vx: number, vz: number, cross: number): number {
    // our right vector in the world: (cos yaw, -sin yaw); perpendicular away from the line: n = side * (-vz, vx)
    const side = cross >= 0 ? 1 : -1;
    const nx = -vz * side, nz = vx * side;
    const rx = cosApprox(o.yaw), rz = -sinApprox(o.yaw);
    return nx * rx + nz * rz >= 0 ? 1 : -1;
  }

  private cover(o: Observation, out: Action, seesTarget: boolean): void {
    const dx = this.coverX - o.x, dz = this.coverZ - o.z;
    if (!this.inCover && dx * dx + dz * dz < 0.5) { this.inCover = true; this.coverUntil = this.t + 9 * C.TICK_HZ; this.path = []; }
    if (this.inCover) {
      out.crouch = true;
      if (o.ammo < C.CLIP) out.reload = true;
      // watch the way the threat would come from
      const s = this.target >= 0 ? this.lastSeen[this.target] : null;
      if (seesTarget && this.target >= 0) { this.engageAim(o, out); return; }
      if (s) this.aim(o, out, wrap(yawTo(s.x - o.x, s.z - o.z) - o.yaw), -o.pitch);
      return;
    }
    this.travel(o, out, 0.4);
    if (seesTarget && this.target >= 0 && this.minDist[this.target] < 10) this.engageAim(o, out); // shoot back while running
    if (!this.path.length && !this.inCover) this.setGoal(o, this.coverX, this.coverZ, 6 * C.TICK_HZ);
  }

  /** Aim and fire at the current target without changing movement (used from cover / while running). */
  private engageAim(o: Observation, out: Action): void {
    const keep = { f: out.forward, s: out.strafe, c: out.crouch, j: out.jump };
    if (this.t < this.reactUntil) return;
    this.engage(o, out, -1);
    out.forward = keep.f; out.strafe = keep.s; out.crouch = keep.c; out.jump = keep.j;
  }

  private patrol(o: Observation, out: Action, mate: number): void {
    if (mate >= 0) {
      // stay loosely near the teammate
      const mx = o.memX[mate], mz = o.memZ[mate];
      const d2 = (mx - o.x) ** 2 + (mz - o.z) ** 2;
      if (d2 > 8 * 8 && (this.t >= this.goalUntil || !this.path.length || (this.goalX - mx) ** 2 + (this.goalZ - mz) ** 2 > 25)) {
        const a = this.rng.range(0, 6.283185307179586);
        this.setGoal(o, mx + 3 * cosApprox(a), mz + 3 * sinApprox(a), 4 * C.TICK_HZ);
        this.state = "regroup";
      } else if (d2 <= 8 * 8 && !this.path.length) {
        this.state = "patrol";
        // check something near the teammate
        const p = this.nearestPoiTo(mx, mz, true);
        this.setGoal(o, p.x, p.z, 8 * C.TICK_HZ);
      }
    } else if (!this.path.length || this.t >= this.goalUntil) {
      const pois = this.world.map.pois;
      const p = pois[this.rng.int(pois.length)];
      this.setGoal(o, p.x, p.z, 15 * C.TICK_HZ);
    }
    this.travel(o, out, 0.45);
  }

  private nearestPoiTo(x: number, z: number, randomish: boolean): { x: number; z: number } {
    const pois = this.world.map.pois;
    let best = pois[0], bd = Infinity;
    for (const p of pois) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2 + (randomish ? this.rng.float() * 60 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private startHunt(o: Observation, flank: boolean): void {
    const s = this.target >= 0 ? this.lastSeen[this.target] : null;
    if (!flank && s && this.t - s.t < 5 * C.TICK_HZ) {
      this.setGoal(o, s.x, s.z, 7 * C.TICK_HZ);
    } else {
      // reposition: somewhere else worth checking
      const pois = this.world.map.pois;
      const p = pois[this.rng.int(pois.length)];
      this.setGoal(o, p.x, p.z, 10 * C.TICK_HZ);
    }
    this.state = "hunt";
  }

  // ---------------------------------------------------------------------------------- movement
  private setGoal(o: Observation, x: number, z: number, ticks: number): void {
    this.goalX = x; this.goalZ = z; this.goalUntil = this.t + ticks;
    this.path = this.nav.findPath(o.x, o.z, x, z);
    this.pathIdx = 0;
    this.stuckX = o.x; this.stuckZ = o.z; this.stuckCheck = this.t + C.TICK_HZ;
  }

  /** Walk along the path, looking where it goes (or toward an alert direction). */
  private travel(o: Observation, out: Action, scan: number): void {
    if (!this.path.length) {
      this.lookAround(o, out, scan, NaN);
      return;
    }
    const nav = this.nav;
    // skip ahead to the farthest node in a straight walkable line (a few per decision)
    for (let s = 0; s < 6 && this.pathIdx < this.path.length - 1; s++) {
      const c = this.path[this.pathIdx + 1];
      if (!nav.lineWalkable(o.x, o.z, nav.cx(c), nav.cz(c))) break;
      this.pathIdx++;
    }
    const c = this.path[this.pathIdx];
    const tx = nav.cx(c), tz = nav.cz(c);
    const dx = tx - o.x, dz = tz - o.z;
    if (dx * dx + dz * dz < 0.3) {
      if (this.pathIdx >= this.path.length - 1) { this.path = []; return this.lookAround(o, out, scan, NaN); }
      this.pathIdx++;
    }
    const moveYaw = yawTo(dx, dz);
    this.moveToward(o, out, moveYaw);
    this.lookAround(o, out, scan, moveYaw);
    // stuck? (a robot in the way, a corner): repath with a hop
    if (this.t >= this.stuckCheck) {
      if ((o.x - this.stuckX) ** 2 + (o.z - this.stuckZ) ** 2 < 0.25) {
        out.jump = true;
        const c2 = nav.randomFree(this.rng);
        this.setGoal(o, nav.cx(c2), nav.cz(c2), 6 * C.TICK_HZ);
      }
      this.stuckX = o.x; this.stuckZ = o.z; this.stuckCheck = this.t + C.TICK_HZ;
    }
  }

  private lookAround(o: Observation, out: Action, scan: number, moveYaw: number): void {
    let want: number;
    if (this.t < this.lookUntil) want = this.lookYawW;
    else if (!Number.isNaN(moveYaw)) {
      // look where it walks, with a slow side-to-side scan
      const phase = ((this.t + this.id * 97) % 240) / 240;
      const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
      want = moveYaw + tri * scan;
    } else {
      const phase = ((this.t + this.id * 97) % 360) / 360;
      want = o.yaw + (phase < 0.5 ? 0.6 : -0.6) * D * this.skill.turnPerTick;
    }
    this.aim(o, out, wrap(want - o.yaw), -0.05 - o.pitch);
  }

  /** Set forward/strafe to walk along world yaw `moveYaw` (8 directions relative to where it looks). */
  private moveToward(o: Observation, out: Action, moveYaw: number): void {
    const rel = wrap(moveYaw - o.yaw);
    const f = cosApprox(rel), s = -sinApprox(rel);
    out.forward = f > 0.38 ? 1 : f < -0.38 ? -1 : 0;
    out.strafe = s > 0.38 ? 1 : s < -0.38 ? -1 : 0;
  }

  /** Turn toward an error (radians), at most the skill's turn speed; spread over the decision's ticks. */
  private aim(o: Observation, out: Action, errY: number, errP: number): void {
    const cap = this.skill.turnPerTick;
    out.yaw = clamp(errY / D, -cap, cap);
    out.pitch = clamp(errP / D, -cap, cap);
  }

  /** Find a spot near the bot that the threat cannot see (map knowledge + where it saw the threat). */
  private planCover(o: Observation, threat: number): boolean {
    const s = this.lastSeen[threat];
    if (!s) return false;
    const nav = this.nav, w = this.world;
    let best = -1, bestScore = Infinity;
    const ci = nav.cellOf(o.x, o.z);
    const i0 = ci % nav.nx, k0 = Math.floor(ci / nav.nx);
    for (let dk = -24; dk <= 24; dk += 2) for (let di = -24; di <= 24; di += 2) {
      const i = i0 + di, k = k0 + dk;
      if (i < 0 || k < 0 || i >= nav.nx || k >= nav.nz) continue;
      const c = k * nav.nx + i;
      if (nav.blocked[c]) continue;
      const x = nav.cx(c), z = nav.cz(c);
      const d = Math.sqrt((x - o.x) ** 2 + (z - o.z) ** 2);
      if (d > 12) continue;
      const toThreat = Math.sqrt((x - s.x) ** 2 + (z - s.z) ** 2);
      const score = d + (toThreat < 6 ? 20 : 0);
      if (score >= bestScore) continue;
      // hidden if a crouched head there cannot be seen from the threat's eye
      if (w.clear(s.x, C.EYE_STAND, s.z, x, C.CROUCH_H - 0.05, z)) continue;
      best = c; bestScore = score;
    }
    if (best < 0) return false;
    this.coverX = nav.cx(best); this.coverZ = nav.cz(best);
    this.inCover = false;
    this.setGoal(o, this.coverX, this.coverZ, 6 * C.TICK_HZ);
    return true;
  }

  /** Debug summary (shown by the renderer with ?debug). */
  describe(): string {
    return `${this.state}${this.target >= 0 ? ` -> ${this.target}` : ""}`;
  }
}
