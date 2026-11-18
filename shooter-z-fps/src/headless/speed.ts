// How fast does the game run with no screen? One core, bot-vs-bot matches back to back.
//   npm run speed                 (5 seconds, 1 vs 3 FFA on both maps, Normal bots)
//   npm run speed -- 20 duel      (20 seconds, 1v1)
import { TICK_HZ } from "../core/config";
import type { Mode } from "../core/game";
import { MAP_IDS } from "../core/maps";
import { Match, standardSlots } from "../core/match";

const seconds = Number(process.argv[2] ?? 5);
const mode = (process.argv[3] ?? "ffa") as Mode;
let ticks = 0, matches = 0, decisions = 0, kills = 0, seed = 1;
const t0 = performance.now(), end = t0 + seconds * 1000;
let m = newMatch();
function newMatch(): Match {
  const map = MAP_IDS[seed % MAP_IDS.length];
  return new Match(seed++, { map, mode, scoreLimit: 10, slots: standardSlots(mode, "normal", { spectate: true, seed }) });
}
while (performance.now() < end) {
  for (let i = 0; i < 600; i++) {
    m.step();
    ticks++;
    if (m.over) {
      matches++;
      kills += m.game.agents.reduce((s, a) => s + a.kills, 0);
      decisions += (m.tick * m.game.n) / 3;
      m = newMatch();
    }
  }
}
const s = (performance.now() - t0) / 1000;
decisions += (m.tick * m.game.n) / 3;
console.log(`Shooter Z headless, one core, ${mode}, ${s.toFixed(1)} s:`);
console.log(`  ${Math.round(ticks / s).toLocaleString()} game steps/s = ${Math.round(ticks / s / TICK_HZ).toLocaleString()}x real time`);
console.log(`  ${Math.round(decisions / s).toLocaleString()} bot decisions/s (observation with ${"256"} labelled rays + decision)`);
console.log(`  ${matches} matches finished (first to 10), ${kills} eliminations`);
