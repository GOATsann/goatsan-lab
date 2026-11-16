// Replay page, driven frame by frame by the video renderer (src/headless/render-replay.ts),
// or played in real time when opened with ?src=<replay.json url>.
import { TICK_HZ } from "../core/config";
import { ReplayPlayer, type Replay } from "../core/game";
import { loadCharacters, makeCharacter } from "./character";
import { mountHud } from "./hud";
import { Renderer } from "./render";

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const renderer = new Renderer(canvas);
(window as unknown as { renderer: Renderer }).renderer = renderer; // debugging
// videos show the track and a label; ?clean hides them (previews, trailers)
const hud = mountHud(document.body, "", { debug: !new URLSearchParams(location.search).has("clean") });
let player: ReplayPlayer | null = null;

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

const api = {
  /** Swap in a runner model (by id, e.g. "boy"). Await before rendering frames. */
  async character(id: string): Promise<void> {
    const info = (await loadCharacters()).find((c) => c.id === id);
    if (info) renderer.setCharacter(await makeCharacter(info));
  },
  load(replay: Replay, label = ""): void {
    player = new ReplayPlayer(replay);
    hud.label(label);
    renderer.draw(player.game);
    hud.update(player.game);
  },
  /** Advance `ticks` game ticks and draw one frame. Returns true when the replay is over. */
  frame(ticks: number): boolean {
    if (!player) return true;
    for (let i = 0; i < ticks; i++) player.step();
    renderer.draw(player.game, ticks / TICK_HZ); // fixed animation time: videos look the same every render
    hud.update(player.game);
    return player.done;
  },
  result() {
    const g = player!.game;
    return { score: g.score, meters: g.meters, coins: g.coins, dead: g.dead, cause: g.deathCause, ticks: g.tick };
  },
};
(window as unknown as { replayApi: typeof api }).replayApi = api;

const src = new URLSearchParams(location.search).get("src");
if (src) {
  fetch(src).then((r) => r.json()).then((rep: Replay) => {
    api.load(rep, "replay");
    let last = performance.now(), acc = 0;
    const tick = (now: number) => {
      acc += now - last; last = now;
      const n = Math.floor(acc / (1000 / TICK_HZ));
      acc -= n * (1000 / TICK_HZ);
      if (!api.frame(n)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
