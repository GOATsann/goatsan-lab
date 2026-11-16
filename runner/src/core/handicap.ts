// Human-like handicaps for the AI opponent. The same trained model plays every level; these make it
// react later, see less far, and sometimes hesitate, the way a person does. It never makes a move the
// model would not make: hesitation only holds "nothing" for a beat.
//
// Shared by the browser race and the Node benchmark (src/headless/bench-opponent.ts), so the levels
// players face are exactly the levels that were measured. Deterministic: one PRNG draw per decision,
// seeded from the race seed, so a race replays the same everywhere.
//
// Use, once per decision (every DECISION_TICKS ticks):
//   observe(game, raw);                 // what is on screen now
//   const seen = filter.see(raw);       // what the AI gets: shorter sight, older
//   const a = policy(seen);             // the trained model's choice
//   const action = filter.decide(a, raw);

import * as C from "./config";
import type { Action } from "./game";
import { CHANNELS, NCH, OBS_SIZE, ROWS, ROW_LEN, STATE } from "./obs";
import { Rng } from "./rng";

/** 0 easy, 1 normal, 2 hard (the game's level index). */
export type LevelIndex = 0 | 1 | 2;

export interface Handicap {
  /** decisions between seeing and acting (1 decision = 1/15 s) */
  delay: number;
  /** obstacles and pickups further than this many metres ahead are hidden (Infinity = all of the grid) */
  sightM: number;
  /** chance per decision, while an obstacle is ahead in its lane, to hesitate */
  hesitateP: number;
  /** decisions a hesitation lasts (it does nothing meanwhile) */
  hesitateFor: number;
  /** how close (metres) an obstacle in its lane must be for a hesitation */
  hesitateNearM: number;
}

/** Per level (index 0 easy, 1 normal, 2 hard). Hard = no handicap: the filter passes everything through.
 *  No reaction delay: the model never trained with old observations, and even 1 decision (67 ms) of delay
 *  made it fidget (about 10x the reversed lane changes) and fall to ~1 min on Normal. Hesitation weakens it
 *  while it still moves like itself; shorter sight is kept (natural, small effect).
 *  Measured with src/headless/bench-opponent.ts (100 seeds per level). */
export const HANDICAPS: readonly Handicap[] = [
  { delay: 0, sightM: 25, hesitateP: 0.08, hesitateFor: 3, hesitateNearM: 20 }, // easy
  { delay: 0, sightM: 40, hesitateP: 0.04, hesitateFor: 2, hesitateNearM: 20 }, // normal
  { delay: 0, sightM: Infinity, hesitateP: 0, hesitateFor: 0, hesitateNearM: 0 }, // hard
];

const GRID = C.LANES * ROWS * NCH;
const FIRST_ROW_MM = -ROW_LEN; // the grid starts one row behind the runner (obs.ts)
const LANE_AT = GRID + STATE.indexOf("lane0");
const OBSTACLES = ["low", "high", "trainFront", "trainBody", "ramp", "moving"].map((c) => CHANNELS.indexOf(c as (typeof CHANNELS)[number]));
const SALT = 0x4a1d_c0de; // keeps the handicap's random stream apart from the track generator's

export class HandicapFilter {
  readonly h: Handicap;
  private rng: Rng;
  private ring: Float32Array[]; // the last delay+1 observations, preallocated (no allocation per decision)
  private pushes = 0;
  private hesitating = 0;
  private readonly hiddenFromRow: number;
  private readonly nearRows: number[];

  /** One per run: make a fresh one on every reset. `custom` overrides the level's settings (calibration). */
  constructor(level: LevelIndex, seed: number, custom?: Handicap) {
    const h = (this.h = custom ?? HANDICAPS[level]);
    this.rng = new Rng((seed ^ SALT) >>> 0);
    this.ring = Array.from({ length: h.delay + 1 }, () => new Float32Array(OBS_SIZE));
    // first row that starts at or beyond the sight limit
    this.hiddenFromRow = Number.isFinite(h.sightM) ? Math.max(0, Math.ceil((h.sightM * 1000 - FIRST_ROW_MM) / ROW_LEN)) : ROWS;
    this.nearRows = [];
    for (let r = 0; r < ROWS; r++) {
      const start = FIRST_ROW_MM + r * ROW_LEN;
      if (start + ROW_LEN > 0 && start < h.hesitateNearM * 1000) this.nearRows.push(r);
    }
  }

  /** What the AI gets to see this decision: the grid cut at its sight limit, `delay` decisions old.
   *  The returned array is an internal buffer: read it, don't keep or change it. */
  see(raw: Float32Array): Float32Array {
    const n = this.ring.length;
    const now = this.ring[this.pushes % n];
    now.set(raw);
    if (this.hiddenFromRow < ROWS) {
      for (let lane = 0; lane < C.LANES; lane++) now.fill(0, (lane * ROWS + this.hiddenFromRow) * NCH, (lane + 1) * ROWS * NCH);
    }
    this.pushes++;
    // `delay` decisions ago; at the very start, the first observation (it has not seen anything older)
    return this.pushes > n ? this.ring[this.pushes % n] : this.ring[0];
  }

  /** The action to play: the model's choice, unless it is hesitating right now. */
  decide(policyAction: Action, raw: Float32Array): Action {
    const roll = this.rng.next() / 2 ** 32; // always one draw per decision, whatever happens
    if (this.hesitating > 0) {
      this.hesitating--;
      return 0;
    }
    if (this.h.hesitateP > 0 && roll < this.h.hesitateP && this.obstacleAhead(raw)) {
      this.hesitating = this.h.hesitateFor - 1;
      return 0;
    }
    return policyAction;
  }

  private obstacleAhead(raw: Float32Array): boolean {
    let lane = 0;
    for (let l = 1; l < C.LANES; l++) if (raw[LANE_AT + l] > raw[LANE_AT + lane]) lane = l;
    for (const r of this.nearRows) for (const c of OBSTACLES) if (raw[(lane * ROWS + r) * NCH + c] > 0) return true;
    return false;
  }
}
