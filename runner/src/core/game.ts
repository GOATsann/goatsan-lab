// The deterministic game core. Pure logic: no rendering, no clock, no Math.random.
// The browser renderer, the headless trainer and the replay renderer all run this same code.
//
// Coordinates: z = distance along the track (mm, grows forward), x = sideways (mm, lane 1 = 0),
// y = height (mm, ground = 0). One call to tick() = 1/60 s.

import * as C from "./config";
import { CHUNKS, type ItemKind } from "./chunks";
import { Rng } from "./rng";

export const NOOP = 0, LEFT = 1, RIGHT = 2, JUMP = 3, ROLL = 4;
export type Action = 0 | 1 | 2 | 3 | 4;
export const ACTION_NAMES = ["nothing", "left", "right", "jump", "roll"] as const;

export const VERSION = 1; // bump when the rules change: old replays no longer match

export type ObstacleKind = "low" | "high" | "train" | "ramp";
export type PickupKind = "coin" | "magnet" | "spring" | "double";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: number;
  z0: number; // near end
  z1: number; // far end
  moving: boolean;
  awake: boolean;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  lane: number;
  z: number;
  y: number;
  taken: boolean;
}

/** What happened during a step. Python turns these into the reward (see train/reward.json). */
export interface Events {
  distance: number; // mm moved forward
  coins: number;
  powerups: number;
  jumps: number;
  rolls: number;
  laneChanges: number;
  stumbles: number;
  died: number; // 0 or 1
  deathCause: string;
}

export const emptyEvents = (): Events => ({
  distance: 0, coins: 0, powerups: 0, jumps: 0, rolls: 0, laneChanges: 0, stumbles: 0, died: 0, deathCause: "",
});

export const laneX = (lane: number) => (lane - 1) * C.LANE_WIDTH;

export interface Replay {
  version: number;
  seed: number;
  endTick: number;
  /** sparse list of [tick, action]; every other tick is "nothing" */
  actions: [number, Action][];
}

export class Game {
  readonly seed: number;
  private rng: Rng;
  tick = 0;

  // runner
  z = 0;
  x = 0;
  y = 0;
  vy = 0;
  lane = 1; // the lane we are in or heading to
  grounded = true;
  rollTicks = 0;
  rollQueued = false;
  stumbleTicks = 0;
  bounceIgnore = -1; // obstacle we just bounced off; ignored while we slide back
  speed = C.START_SPEED;
  magnetTicks = 0;
  springTicks = 0;
  doubleTicks = 0;

  // result
  coins = 0;
  coinScore = 0;
  dead = false;
  deathCause = "";

  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  private nextChunkZ = C.RUNWAY;
  private nextId = 1;
  private log: [number, Action][] = [];
  events: Events = emptyEvents();

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.buildTrack();
  }

  get meters(): number {
    return Math.floor(this.z / 1000);
  }

  get score(): number {
    return this.meters + this.coinScore;
  }

  get rolling(): boolean {
    return this.rollTicks > 0;
  }

  /** Advance one tick (1/60 s). `action` applies at this tick; use NOOP otherwise. */
  step(action: Action = NOOP): void {
    if (this.dead) return;
    if (action !== NOOP) this.log.push([this.tick, action]);
    this.applyAction(action);

    // sideways: slide toward the target lane
    const tx = laneX(this.lane);
    if (this.x < tx) this.x = Math.min(tx, this.x + C.LANE_STEP);
    else if (this.x > tx) this.x = Math.max(tx, this.x - C.LANE_STEP);
    if (this.bounceIgnore >= 0 && this.x === tx) this.bounceIgnore = -1;

    // forward
    const prevZ = this.z;
    this.z += this.speed;
    this.events.distance += this.speed;
    for (const o of this.obstacles) {
      if (!o.moving) continue;
      if (!o.awake && o.z0 - this.z < C.MOVING_TRAIN_WAKE) o.awake = true;
      if (o.awake) {
        o.z0 -= C.MOVING_TRAIN_SPEED;
        o.z1 -= C.MOVING_TRAIN_SPEED;
      }
    }

    // up and down
    const ground = this.groundAt(this.y);
    this.vy -= C.GRAVITY;
    this.y += this.vy;
    if (this.y <= ground) {
      this.y = ground;
      this.vy = 0;
      if (!this.grounded && this.rollQueued) {
        this.rollTicks = C.ROLL_TICKS;
        this.rollQueued = false;
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    if (this.rollTicks > 0) this.rollTicks--;

    this.collide(prevZ);
    if (!this.dead) this.pickUp();

    // timers
    if (this.stumbleTicks > 0) this.stumbleTicks--;
    if (this.magnetTicks > 0) this.magnetTicks--;
    if (this.springTicks > 0) this.springTicks--;
    if (this.doubleTicks > 0) this.doubleTicks--;
    this.tick++;
    if (this.tick % C.SPEEDUP_EVERY === 0 && this.speed < C.MAX_SPEED) this.speed++;
    this.buildTrack();
  }

  /** One AI decision: the action, then nothing for the rest of the decision (4 ticks). */
  decide(action: Action): Events {
    this.events = emptyEvents();
    for (let i = 0; i < C.DECISION_TICKS && !this.dead; i++) this.step(i === 0 ? action : NOOP);
    return this.events;
  }

  replay(): Replay {
    return { version: VERSION, seed: this.seed, endTick: this.tick, actions: this.log.slice() };
  }

  static fromReplay(r: Replay, upToTick = r.endTick): Game {
    if (r.version !== VERSION) throw new Error(`replay is for rules v${r.version}, this core is v${VERSION}`);
    const g = new Game(r.seed);
    let i = 0;
    while (g.tick < upToTick && !g.dead) {
      let a: Action = NOOP;
      if (i < r.actions.length && r.actions[i][0] === g.tick) a = r.actions[i++][1];
      g.step(a);
    }
    return g;
  }

  /** An independent copy (for search, lookahead and tests). */
  clone(): Game {
    const g = Object.create(Game.prototype) as Game;
    Object.assign(g, this);
    g.rng = Object.assign(Object.create(Rng.prototype), { s: new Uint32Array(this.rng.s) });
    g.obstacles = this.obstacles.map((o) => ({ ...o }));
    g.pickups = this.pickups.map((p) => ({ ...p }));
    g.log = this.log.slice();
    g.events = { ...this.events };
    return g;
  }

  /** FNV-1a hash of everything that matters; equal hashes = identical games. */
  hash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      v = v | 0;
      for (let k = 0; k < 4; k++) {
        h ^= (v >>> (k * 8)) & 0xff;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    };
    for (const v of [this.tick, this.z, this.x, this.y, this.vy, this.lane, this.rollTicks, this.speed,
      this.coins, this.coinScore, this.dead ? 1 : 0, this.stumbleTicks, this.magnetTicks, this.springTicks,
      this.doubleTicks, this.nextChunkZ]) mix(v);
    for (const s of this.rng.s) mix(s);
    for (const o of this.obstacles) { mix(o.id); mix(o.z0); mix(o.lane); }
    for (const p of this.pickups) { mix(p.id); mix(p.taken ? 1 : 0); }
    return h >>> 0;
  }

  // ---------------------------------------------------------------- rules

  private applyAction(a: Action): void {
    if (a === LEFT || a === RIGHT) {
      const target = this.lane + (a === LEFT ? -1 : 1);
      if (target >= 0 && target < C.LANES) {
        this.lane = target;
        this.events.laneChanges++;
      }
    } else if (a === JUMP) {
      if (this.grounded) {
        this.vy = this.springTicks > 0 ? C.SPRING_JUMP_V : C.JUMP_V;
        this.grounded = false;
        this.rollTicks = 0;
        this.events.jumps++;
      }
    } else if (a === ROLL) {
      if (this.grounded) this.rollTicks = C.ROLL_TICKS;
      else {
        this.vy = Math.min(this.vy, C.FAST_DROP_V);
        this.rollQueued = true;
      }
      this.events.rolls++;
    }
  }

  private overlapsX(lane: number, halfW: number): boolean {
    return Math.abs(this.x - laneX(lane)) < halfW + C.PLAYER_W / 2;
  }

  /** The surface under the runner: ground, a ramp, or a train roof we are already on top of. */
  private groundAt(feetY: number): number {
    let g = 0;
    for (const o of this.obstacles) {
      if (this.z < o.z0 || this.z > o.z1 || !this.overlapsX(o.lane, C.OBSTACLE_W / 2)) continue;
      if (o.kind === "ramp") g = Math.max(g, Math.floor((C.TRAIN.height * (this.z - o.z0)) / C.RAMP_LEN));
      else if (o.kind === "train" && feetY >= C.TRAIN.height - C.STEP_UP) g = Math.max(g, C.TRAIN.height);
    }
    return g;
  }

  private collide(prevZ: number): void {
    const h = this.rolling ? C.PLAYER_ROLL_H : C.PLAYER_H;
    const pz0 = this.z - C.PLAYER_LEN / 2, pz1 = this.z + C.PLAYER_LEN / 2;
    for (const o of this.obstacles) {
      if (o.kind === "ramp" || o.id === this.bounceIgnore) continue;
      if (!this.overlapsX(o.lane, C.OBSTACLE_W / 2)) continue;
      if (pz1 <= o.z0 || pz0 >= o.z1) continue;
      const [y0, y1] = o.kind === "low" ? [C.LOW_BARRIER.y0, C.LOW_BARRIER.y1]
        : o.kind === "high" ? [C.HIGH_BARRIER.y0, C.HIGH_BARRIER.y1] : [0, C.TRAIN.height];
      if (o.kind === "train" && this.y >= C.TRAIN.height - C.STEP_UP) continue; // on the roof
      if (this.y + h <= y0 || this.y >= y1) continue;

      // Already level with it last tick? Then we came in from the side (a lane change into it).
      const mv = o.moving && o.awake ? C.MOVING_TRAIN_SPEED : 0;
      const wasLevel = prevZ + C.PLAYER_LEN / 2 > o.z0 + mv && prevZ - C.PLAYER_LEN / 2 < o.z1 + mv;
      if (wasLevel && this.x !== laneX(this.lane)) {
        this.events.stumbles++;
        if (this.stumbleTicks > 0) return this.die(`${o.kind} side, twice`);
        this.stumbleTicks = C.STUMBLE_TICKS;
        this.bounceIgnore = o.id;
        // bounce back to the lane next to it, on the side we came from
        this.lane = o.lane + (this.x < laneX(o.lane) ? -1 : 1);
        continue;
      }
      return this.die(o.moving ? "oncoming train" : `${o.kind} front`);
    }
  }

  private die(cause: string): void {
    this.dead = true;
    this.deathCause = cause;
    this.events.died = 1;
    this.events.deathCause = cause;
  }

  private pickUp(): void {
    const h = this.rolling ? C.PLAYER_ROLL_H : C.PLAYER_H;
    for (const p of this.pickups) {
      if (p.taken) continue;
      const dz = p.z - this.z;
      let hit: boolean;
      if (p.kind === "coin" && this.magnetTicks > 0) hit = dz > -C.COIN_REACH && dz < C.MAGNET_REACH;
      else hit = Math.abs(dz) < C.COIN_REACH && this.overlapsX(p.lane, C.COIN_REACH)
        && p.y > this.y - C.COIN_REACH && p.y < this.y + h + C.COIN_REACH;
      if (!hit) continue;
      p.taken = true;
      if (p.kind === "coin") {
        this.coins++;
        this.coinScore += C.SCORE_COIN * (this.doubleTicks > 0 ? 2 : 1);
        this.events.coins++;
      } else {
        this.events.powerups++;
        if (p.kind === "magnet") this.magnetTicks = C.POWER_TICKS;
        if (p.kind === "spring") this.springTicks = C.POWER_TICKS;
        if (p.kind === "double") this.doubleTicks = C.POWER_TICKS;
      }
    }
  }

  // ---------------------------------------------------------------- track

  private buildTrack(): void {
    while (this.nextChunkZ < this.z + C.VIEW_DISTANCE) {
      const meters = this.nextChunkZ / 1000;
      const pool = CHUNKS.filter((c) => c.minMeters <= meters);
      const chunk = this.rng.weighted(pool, pool.map((c) => c.weight));
      const perm = PERMS[this.rng.int(PERMS.length)];
      const base = this.nextChunkZ;
      for (const it of chunk.items) this.place(it.kind, perm[it.slot], base + it.z, it.onRoof ?? false, it.lift ?? 0);
      this.nextChunkZ += chunk.len;
    }
    const behind = this.z - 15000;
    if (this.obstacles.length && this.obstacles[0].z1 < behind) this.obstacles = this.obstacles.filter((o) => o.z1 >= behind);
    if (this.pickups.length && this.pickups[0].z < behind) this.pickups = this.pickups.filter((p) => p.z >= behind);
  }

  private place(kind: ItemKind, lane: number, z: number, onRoof: boolean, lift: number): void {
    const id = this.nextId++;
    switch (kind) {
      case "low": this.obstacles.push({ id, kind, lane, z0: z, z1: z + C.LOW_BARRIER.len, moving: false, awake: false }); break;
      case "high": this.obstacles.push({ id, kind, lane, z0: z, z1: z + C.HIGH_BARRIER.len, moving: false, awake: false }); break;
      case "train": this.obstacles.push({ id, kind, lane, z0: z, z1: z + C.TRAIN.len, moving: false, awake: false }); break;
      case "movingTrain": this.obstacles.push({ id, kind: "train", lane, z0: z, z1: z + C.TRAIN.len, moving: true, awake: false }); break;
      case "ramp": this.obstacles.push({ id, kind, lane, z0: z, z1: z + C.RAMP_LEN, moving: false, awake: false }); break;
      default: {
        const y = (onRoof ? C.TRAIN.height : 0) + C.COIN_HEIGHT + lift;
        this.pickups.push({ id, kind, lane, z, y, taken: false });
      }
    }
  }
}

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
