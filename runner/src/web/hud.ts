// The score display, shared by the game page and the replay/video page.
import { TICK_HZ } from "../core/config";
import type { Game } from "../core/game";

export function mountHud(root: HTMLElement, label = "") {
  root.insertAdjacentHTML("beforeend", `
    <div class="hud"><div><small>score</small><b data-score>0</b></div>
      <div style="text-align:right"><small data-meta></small><small data-seed></small><small data-label></small></div></div>
    <div class="powers" data-powers></div>`);
  const q = (s: string) => root.querySelector(`[data-${s}]`) as HTMLElement;
  q("label").textContent = label;
  return {
    update(g: Game): void {
      q("score").textContent = String(g.score);
      q("meta").textContent = `${g.meters} m · ${g.coins} coins`;
      q("seed").textContent = `track ${g.seed}`;
      const p: string[] = [];
      if (g.magnetTicks) p.push(`magnet ${Math.ceil(g.magnetTicks / TICK_HZ)}s`);
      if (g.springTicks) p.push(`spring shoes ${Math.ceil(g.springTicks / TICK_HZ)}s`);
      if (g.doubleTicks) p.push(`2x coins ${Math.ceil(g.doubleTicks / TICK_HZ)}s`);
      q("powers").replaceChildren(...p.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
    },
    label(text: string): void { q("label").textContent = text; },
  };
}
