// Rebuild a match from a replay file (seed + options + inputs) and check it ends in the same state.
//   npm run replay -- runs/match-base-duel-7.json
import { readFileSync } from "node:fs";
import { TICK_HZ } from "../core/config";
import { Match, type Replay } from "../core/match";

const file = process.argv[2];
if (!file) { console.error("usage: npm run replay -- <replay.json>"); process.exit(1); }
const r = JSON.parse(readFileSync(file, "utf8")) as Replay;
const t0 = performance.now();
const m = Match.fromReplay(r);
const ms = performance.now() - t0;
const ok = m.game.hash() === r.hash;
console.log(`seed ${r.seed}, ${r.options.map}, ${r.options.mode}: ${(r.endTick / TICK_HZ).toFixed(1)} s rebuilt in ${ms.toFixed(0)} ms`);
console.log(`scores ${m.game.teamScore.join(" : ")}; hash ${ok ? "matches" : "DIFFERS"}`);
process.exit(ok ? 0 : 2);
