// What the AI sees: the same things a player sees on screen, as numbers.
//
// 1. A lane grid ahead of the runner: 3 lanes x ROWS rows of ROW_LEN mm each, starting one row
//    behind the runner (so trains beside it are visible). Each cell has one channel per thing.
// 2. The runner's own state.
// Nothing beyond VIEW_DISTANCE: the AI cannot see further than a human.
// The chaser is hidden from the AI unless observeChaser is on (it must learn to run clean anyway).

import * as C from "./config";
import type { Game } from "./game";

export const ROWS = 32;
export const ROW_LEN = 3000;
export const CHANNELS = ["low", "high", "trainFront", "trainBody", "ramp", "coin", "moving", "magnet", "spring", "double", "shield"] as const;
export const NCH = CHANNELS.length;
export const STATE = [
  "lane0", "lane1", "lane2", "x", "y", "vy", "grounded", "rolling", "onRoof", "speed",
  "slowed", "magnet", "spring", "double", "shield", "heat",
  "chaserNear", "stumbleCount", // 0 unless observeChaser
] as const;
export const OBS_SIZE = C.LANES * ROWS * NCH + STATE.length;

const START = -ROW_LEN; // the grid starts one row behind the runner

const cell = (lane: number, row: number, ch: number) => (lane * ROWS + row) * NCH + ch;

export interface ObsOptions {
  observeChaser: boolean;
}
export const DEFAULT_OBS: ObsOptions = { observeChaser: false };

const PICKUP_CH: Record<string, number> = { coin: 5, magnet: 7, spring: 8, double: 9, shield: 10 };

/** Fill `out` (length OBS_SIZE) with the observation. Reuses the buffer: no allocation per step. */
export function observe(g: Game, out: Float32Array, opts: ObsOptions = DEFAULT_OBS): Float32Array {
  out.fill(0);
  const near = g.z + START, far = near + ROWS * ROW_LEN;
  const rowOf = (z: number) => Math.floor((z - near) / ROW_LEN);

  for (const o of g.obstacles) {
    if (o.broken || o.z1 < near || o.z0 >= far) continue;
    const r0 = Math.max(0, rowOf(o.z0)), r1 = Math.min(ROWS - 1, rowOf(o.z1 - 1));
    for (let r = r0; r <= r1; r++) {
      let ch: number;
      if (o.kind === "low") ch = 0;
      else if (o.kind === "high") ch = 1;
      else if (o.kind === "ramp") ch = 4;
      else ch = r === rowOf(o.z0) ? 2 : 3;
      out[cell(o.lane, r, ch)] = 1;
      if (o.moving) out[cell(o.lane, r, 6)] = 1;
    }
  }
  for (const p of g.pickups) {
    if (p.taken || p.z < near || p.z >= far) continue;
    out[cell(p.lane, rowOf(p.z), PICKUP_CH[p.kind])] = 1;
  }

  let i = C.LANES * ROWS * NCH;
  for (let l = 0; l < C.LANES; l++) out[i++] = g.lane === l ? 1 : 0;
  out[i++] = g.x / C.LANE_WIDTH;
  out[i++] = g.y / C.TRAIN.height;
  out[i++] = g.vy / C.SPRING_JUMP_V;
  out[i++] = g.grounded ? 1 : 0;
  out[i++] = g.rolling ? 1 : 0;
  out[i++] = g.y >= C.TRAIN.height - C.STEP_UP ? 1 : 0;
  out[i++] = (g.speed - C.START_SPEED) / (2 * C.SPEED_PER_HEAT); // 0 at heat 0, 1 at heat 2; keeps growing
  out[i++] = g.slowTicks / C.STUMBLE_SLOW_TICKS;
  out[i++] = g.magnetTicks / C.POWER_TICKS;
  out[i++] = g.springTicks / C.POWER_TICKS;
  out[i++] = g.doubleTicks / C.POWER_TICKS;
  out[i++] = g.shieldTicks / C.SHIELD_TICKS;
  out[i++] = g.heat / 2; // how hard the track is right now (a human sees this as speed and density)
  out[i++] = opts.observeChaser ? g.chaserTicks / C.CHASER_TICKS : 0;
  out[i++] = opts.observeChaser ? g.stumbleCount / g.options.stumblesToCatch : 0;
  return out;
}
