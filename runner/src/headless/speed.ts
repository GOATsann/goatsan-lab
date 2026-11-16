// How fast does the game run with no screen? One core, random actions, games restart on death.
//   npm run speed            (5 seconds)
//   npm run speed -- 20      (20 seconds)
import { DECISION_TICKS, TICK_HZ } from "../core/config";
import { Game, type Action } from "../core/game";
import { OBS_SIZE, observe } from "../core/obs";
import { Rng } from "../core/rng";

const seconds = Number(process.argv[2] ?? 5);
const rng = new Rng(123);
const obs = new Float32Array(OBS_SIZE);
let game = new Game(0), seed = 0, decisions = 0, games = 0;
const t0 = performance.now(), end = t0 + seconds * 1000;
while (performance.now() < end) {
  for (let i = 0; i < 1000; i++) {
    // mostly "nothing", like a real policy, so games last a while
    const r = rng.int(10);
    game.decide((r < 6 ? 0 : r - 5) as Action);
    observe(game, obs);
    decisions++;
    if (game.dead) { game = new Game(++seed); games++; }
  }
}
const s = (performance.now() - t0) / 1000;
const ticks = (decisions * DECISION_TICKS) / s;
console.log(`one core, ${s.toFixed(1)} s:`);
console.log(`  ${Math.round(decisions / s).toLocaleString()} AI decisions/s (game steps + observations)`);
console.log(`  ${Math.round(ticks).toLocaleString()} game ticks/s = ${Math.round(ticks / TICK_HZ).toLocaleString()}x real time`);
console.log(`  ${games} games played`);
