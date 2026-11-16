// Make reference replays in Node: seed, actions, and the hash after every 600 ticks.
import { writeFileSync } from "node:fs";
import { botAction } from "../../src/core/bot";
import { Game } from "../../src/core/game";
import { Rng } from "../../src/core/rng";

const out = [];
for (const seed of [1, 7, 42, 1000, 123456]) {
  const g = new Game(seed);
  const r = new Rng(seed);
  // mix the search bot with random moves, so replays cover deaths, bounces, roofs and power-ups
  while (!g.dead && g.tick < 12000) g.decide(r.int(8) === 0 ? (r.int(5) as 0) : botAction(g));
  const replay = g.replay();
  const checkpoints: [number, number][] = [];
  for (let t = 600; t <= replay.endTick; t += 600) checkpoints.push([t, Game.fromReplay(replay, t).hash()]);
  checkpoints.push([replay.endTick, g.hash()]);
  out.push({ replay, checkpoints, score: g.score });
}
writeFileSync(new URL("./replays.json", import.meta.url), JSON.stringify(out));
console.log(out.map((o) => `seed ${o.replay.seed}: ${o.replay.endTick} ticks, score ${o.score}`).join("\n"));
