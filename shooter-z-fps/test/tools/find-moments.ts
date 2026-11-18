// Find filmable moments in a deterministic bot match (for the capture page's match scene):
// state changes (patrol -> engage, -> cover), eliminations, headshots by robot 0, and robot 0 seeing a
// hit enemy outlined behind cover.
//   npx tsx test/tools/find-moments.ts <mode> <map> <seed> [skill] [skill0]
import type { SkillName } from "../../src/core/bot";
import type { Mode } from "../../src/core/game";
import type { MapId } from "../../src/core/maps";
import { Match, standardSlots } from "../../src/core/match";

const [mode = "duel", map = "base", seedArg = "1", skill = "normal", skill0 = ""] = process.argv.slice(2);
const seed = Number(seedArg);
const slots = standardSlots(mode as Mode, skill as SkillName, { spectate: true, seed });
if (skill0) slots[0].skill = skill0 as SkillName;
const m = new Match(seed, { map: map as MapId, mode: mode as Mode, scoreLimit: 10, slots });
const prev: string[] = m.bots.map((b) => b!.state);
const out: string[] = [];
let lastOutline = -999;
while (!m.over && m.tick < 60 * 60 * 6) {
  m.step();
  const g = m.game;
  m.bots.forEach((b, i) => {
    if (b!.state !== prev[i]) {
      if (b!.state === "engage" || b!.state === "cover") out.push(`${g.tick} bot${i} ${prev[i]} -> ${b!.state}`);
      prev[i] = b!.state;
    }
  });
  for (const e of g.events) {
    if (e.type === "kill") out.push(`${g.tick} KILL ${e.a} -> ${e.v} (${e.part})`);
    if (e.type === "hit" && e.a === 0 && e.part === "head") out.push(`${g.tick} HEADSHOT by 0`);
    if (e.type === "ability") out.push(`${g.tick} ability ${e.kind} by ${e.a}`);
  }
  // robot 0 has an outlined enemy that is behind cover right now
  const me = g.agents[0];
  if (me.alive && g.tick - lastOutline > 120) {
    for (const a of g.agents) {
      if (a.id === 0 || !a.alive || a.outlineFor[0] <= 0 || a.team === me.team) continue;
      if (!g.world.clear(me.x, g.eyeY(me), me.z, a.x, a.y + 1.2, a.z)) { out.push(`${g.tick} OUTLINE-BEHIND-COVER ${a.id} for 0`); lastOutline = g.tick; }
    }
  }
}
console.log(out.join("\n"));
console.log(`end tick ${m.tick}, scores ${m.game.teamScore.join(":")}`);
