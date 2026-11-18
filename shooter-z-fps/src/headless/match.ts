// Play one bot-vs-bot match headless, print the result, save its replay and check that the replay
// rebuilds the exact same match.
//   npm run match -- --seed 7 --mode duel --map base --skill hard [--limit 10] [--out runs/match.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CHARACTERS } from "../core/characters";
import { TICK_HZ } from "../core/config";
import type { SkillName } from "../core/bot";
import type { Mode } from "../core/game";
import type { MapId } from "../core/maps";
import { Match, standardSlots } from "../core/match";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const seed = Number(arg("seed", "7"));
const mode = arg("mode", "duel") as Mode;
const map = arg("map", "base") as MapId;
const skill = arg("skill", "normal") as SkillName;
const limit = Number(arg("limit", "10"));
const out = arg("out", `runs/match-${map}-${mode}-${seed}.json`);

const m = new Match(seed, { map, mode, scoreLimit: limit, slots: standardSlots(mode, skill, { spectate: true, seed }) });
const states: Record<string, number>[] = m.game.agents.map(() => ({}));
const used = m.game.agents.map(() => 0), blocks = m.game.agents.map(() => 0);
const t0 = performance.now();
while (!m.over && m.tick < 60 * 60 * 20) {
  m.step();
  m.bots.forEach((b, i) => { if (b) states[i][b.state] = (states[i][b.state] ?? 0) + 1; });
  m.game.stats.forEach((st, i) => { used[i] += st.abilities; blocks[i] += st.shieldBlocks; });
}
const ms = performance.now() - t0;
const g = m.game;
console.log(`match seed ${seed}, ${map}, ${mode}, ${skill} bots: ${(g.tick / TICK_HZ).toFixed(1)} s of game in ${ms.toFixed(0)} ms (${Math.round(g.tick / (ms / 1000)).toLocaleString()} steps/s)`);
console.log(`winner: team ${g.winnerTeam}, team scores ${g.teamScore.join(" : ")}`);
for (const a of g.agents) {
  const ch = CHARACTERS[a.character];
  const name = `${m.options.slots[a.id].name} (${ch.name}, ${ch.abilityName} x${used[a.id]}${ch.ability === "shield" ? `, ${blocks[a.id]} blocked` : ""})`;
  const acc = a.shots ? ((100 * a.hits) / a.shots).toFixed(0) : "-";
  const hs = a.hits ? ((100 * a.headshots) / a.hits).toFixed(0) : "-";
  const st = Object.entries(states[a.id]).map(([k, v]) => `${k} ${Math.round((100 * v) / g.tick)}%`).join(", ");
  console.log(`  ${name.padEnd(36)} team ${a.team}  K ${a.kills}  D ${a.deaths}  accuracy ${acc}%  headshots ${hs}% of hits   [${st}]`);
}
const replay = m.replay();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(replay));
const again = Match.fromReplay(JSON.parse(JSON.stringify(replay)));
console.log(`replay saved to ${out}; rebuilt hash ${again.game.hash() === replay.hash ? "matches" : "DIFFERS"} (${replay.hash.toString(16)})`);
