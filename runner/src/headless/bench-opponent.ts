// Benchmark the AI opponent exactly as players face it: the trained policy (ONNX, the same
// onnxruntime-web as the browser) behind the level's HandicapFilter (src/core/handicap.ts).
//
//   npx tsx src/headless/bench-opponent.ts                       # all 3 levels, seeds 1000-1099
//   npx tsx src/headless/bench-opponent.ts --levels 0 --handicap '{"delay":5,"sightM":20,"hesitateP":0.1,"hesitateFor":3,"hesitateNearM":20}'
//   ... --model runs/r4-v4-long/policy.onnx --out runs/r4-v4-long/opponent-bench.json
//
// All seeds of a level run in lockstep, one batched inference per decision. Each opponent plays the
// track level it is the opponent for (Easy AI on Easy tracks), seeded per track, like in a race.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as ort from "onnxruntime-web";
import { LEVEL_NAMES, TICK_HZ } from "../core/config";
import { Game, type Action } from "../core/game";
import { HANDICAPS, HandicapFilter, type Handicap, type LevelIndex } from "../core/handicap";
import { CHANNELS, NCH, OBS_SIZE, ROWS, STATE, observe } from "../core/obs";
import * as C from "../core/config";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const MODEL = arg("model", "runs/r4-v4-long/policy.onnx");
const LEVELS = arg("levels", "0,1,2").split(",").map(Number) as LevelIndex[];
const SEED0 = Number(arg("seed-start", "1000"));
const N = Number(arg("episodes", "100"));
const MAX_TICKS = Number(arg("max-minutes", "30")) * 60 * TICK_HZ;
const CUSTOM: Handicap | undefined = process.argv.includes("--handicap") ? JSON.parse(arg("handicap", "{}")) : undefined;
const OUT = arg("out", "");
const REPLAYS = arg("replays", ""); // folder: saves the replays of the worst, median and best run of each level

// wasted-move measures, same definitions as train/runner_env.py
const REVERSE_DECISIONS = 8;
const GRID = C.LANES * ROWS * NCH;
const LANE_AT = GRID + STATE.indexOf("lane0");
const OBST = ["low", "high", "trainFront", "trainBody", "ramp", "moving"].map((c) => CHANNELS.indexOf(c as (typeof CHANNELS)[number]));
const REACH_ROWS = [1, 2, 3, 4]; // 0-12 m ahead
const laneOf = (o: Float32Array) => { let l = 0; for (let i = 1; i < C.LANES; i++) if (o[LANE_AT + i] > o[LANE_AT + l]) l = i; return l; };
const obstacleAhead = (o: Float32Array) => {
  const lane = laneOf(o);
  for (const r of REACH_ROWS) for (const c of OBST) if (o[(lane * ROWS + r) * NCH + c] > 0) return true;
  return false;
};

interface Result { seed: number; score: number; seconds: number; meters: number; death: string; moves: number; reversals: number; pointless: number; hesitations: number }

async function benchLevel(session: ort.InferenceSession, level: LevelIndex): Promise<{ rows: Result[]; games: Game[] }> {
  const games = Array.from({ length: N }, (_, i) => new Game(SEED0 + i, { level }));
  const filters = games.map((g) => new HandicapFilter(level, g.seed, CUSTOM));
  const raw = games.map(() => new Float32Array(OBS_SIZE));
  const stats = games.map(() => ({ moves: 0, reversals: 0, pointless: 0, hesitations: 0, t: 0, lastTurn: 0, lastTurnT: -1e9 }));
  const batch = new Float32Array(N * OBS_SIZE);
  while (true) {
    const alive = games.map((g, i) => (!g.dead && g.tick < MAX_TICKS ? i : -1)).filter((i) => i >= 0);
    if (!alive.length) break;
    alive.forEach((i, k) => {
      observe(games[i], raw[i]);
      batch.set(filters[i].see(raw[i]), k * OBS_SIZE);
    });
    const out = await session.run({ obs: new ort.Tensor("float32", batch.subarray(0, alive.length * OBS_SIZE), [alive.length, OBS_SIZE]) });
    const logits = out.logits.data as Float32Array;
    alive.forEach((i, k) => {
      let best = 0;
      for (let a = 1; a < 5; a++) if (logits[k * 5 + a] > logits[k * 5 + best]) best = a;
      const action = filters[i].decide(best as Action, raw[i]);
      const s = stats[i];
      if (action === 0 && best !== 0) s.hesitations++;
      const ev = games[i].decide(action);
      if (action !== 0) s.moves++;
      const dir = action === 1 ? -1 : action === 2 ? 1 : 0;
      if (ev.laneChanges > 0 && dir !== 0) {
        if (s.lastTurn === -dir && s.t - s.lastTurnT <= REVERSE_DECISIONS) s.reversals++;
        s.lastTurn = dir; s.lastTurnT = s.t;
      }
      if (((action === 3 && ev.jumps > 0) || (action === 4 && ev.rolls > 0)) && !obstacleAhead(raw[i])) s.pointless++;
      s.t++;
    });
  }
  const rows = games.map((g, i) => {
    const per100 = 100 / Math.max(g.meters, 1);
    return {
      seed: g.seed, score: g.score, seconds: g.tick / TICK_HZ, meters: g.meters, death: g.dead ? g.deathCause : "time limit",
      moves: stats[i].moves * per100, reversals: stats[i].reversals * per100, pointless: stats[i].pointless * per100, hesitations: stats[i].hesitations,
    };
  });
  return { rows, games };
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const ci = (a: number[]) => { const m = mean(a); return 1.96 * Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) / Math.sqrt(a.length); };

async function main() {
  ort.env.logLevel = "error";
  const session = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ["wasm"] });
  const report: Record<string, unknown> = { model: MODEL, seeds: [SEED0, SEED0 + N - 1], maxMinutes: MAX_TICKS / 60 / TICK_HZ, levels: {} };
  for (const level of LEVELS) {
    const t0 = Date.now();
    const { rows, games } = await benchLevel(session, level);
    if (REPLAYS) {
      mkdirSync(REPLAYS, { recursive: true });
      const order = rows.map((_, i) => i).sort((a, b) => rows[a].seconds - rows[b].seconds);
      for (const [tag, i] of [["worst", order[0]], ["median", order[order.length >> 1]], ["best", order.at(-1)!]] as const) {
        writeFileSync(`${REPLAYS}/${LEVEL_NAMES[level]}-${tag}-seed${rows[i].seed}.json`, JSON.stringify(games[i].replay()));
      }
    }
    const deaths: Record<string, number> = {};
    for (const r of rows) deaths[r.death] = (deaths[r.death] ?? 0) + 1;
    const summary = {
      handicap: CUSTOM ?? HANDICAPS[level],
      medianMinutes: +(median(rows.map((r) => r.seconds)) / 60).toFixed(2),
      meanScore: Math.round(mean(rows.map((r) => r.score))), scoreCi: Math.round(ci(rows.map((r) => r.score))),
      movesPer100m: +mean(rows.map((r) => r.moves)).toFixed(1), reversalsPer100m: +mean(rows.map((r) => r.reversals)).toFixed(2),
      pointlessPer100m: +mean(rows.map((r) => r.pointless)).toFixed(2), hesitationsPerRun: +mean(rows.map((r) => r.hesitations)).toFixed(1),
      deaths,
    };
    (report.levels as Record<string, unknown>)[LEVEL_NAMES[level]] = { ...summary, rows };
    console.log(`${LEVEL_NAMES[level]}: median ${summary.medianMinutes} min, score ${summary.meanScore} ± ${summary.scoreCi}, ` +
      `moves ${summary.movesPer100m}/100m, reversals ${summary.reversalsPer100m}, pointless ${summary.pointlessPer100m}, ` +
      `hesitations ${summary.hesitationsPerRun}/run, deaths ${JSON.stringify(deaths)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(report));
}

void main();
