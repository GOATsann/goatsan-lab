// The score display, shared by the game page and the replay/video page.
import * as C from "../core/config";
import type { Game } from "../core/game";

export function mountHud(root: HTMLElement, label = "") {
  root.insertAdjacentHTML("beforeend", `
    <div class="danger" data-danger></div>
    <div class="hud"><div><small>score</small><b data-score>0</b></div>
      <div style="text-align:right"><small data-meta></small><small data-seed></small><small data-label></small></div></div>
    <div class="powers" data-powers></div>
    <div class="chaser" data-chaser hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a8 8 0 0 0-8 8v11l2.7-2 2.6 2 2.7-2 2.7 2 2.6-2L20 21V10a8 8 0 0 0-8-8z" fill="#0b0c1c" stroke="#ffd36a" stroke-width="1.2"/><circle cx="9" cy="10" r="1.6" fill="#ffd36a"/><circle cx="15" cy="10" r="1.6" fill="#ffd36a"/></svg><span data-pips></span></div>`);
  const q = (s: string) => root.querySelector(`[data-${s}]`) as HTMLElement;
  q("label").textContent = label;
  return {
    update(g: Game): void {
      // the chaser never hides the track: a red pulse only at the screen edges, plus an icon
      const near = g.dead ? 0 : Math.max(0, Math.min(1, 1 - (g.chaserGap - C.CHASER_CLOSE) / 20000));
      q("danger").style.opacity = String(near);
      const chaser = q("chaser");
      chaser.hidden = g.dead || g.chaserTicks === 0;
      if (!chaser.hidden) {
        const n = g.options.stumblesToCatch;
        q("pips").textContent = "●".repeat(g.stumbleCount) + "○".repeat(Math.max(0, n - g.stumbleCount));
      }
      q("score").textContent = String(g.score);
      q("meta").textContent = `${g.meters} m · ${g.coins} coins`;
      q("seed").textContent = `track ${g.seed}`;
      const p: string[] = [];
      if (g.dead) { q("powers").replaceChildren(); return; }
      if (g.magnetTicks) p.push(`magnet ${Math.ceil(g.magnetTicks / C.TICK_HZ)}s`);
      if (g.springTicks) p.push(`spring shoes ${Math.ceil(g.springTicks / C.TICK_HZ)}s`);
      if (g.doubleTicks) p.push(`2x coins ${Math.ceil(g.doubleTicks / C.TICK_HZ)}s`);
      if (g.shieldTicks) p.push(`shield ${Math.ceil(g.shieldTicks / C.TICK_HZ)}s`);
      q("powers").replaceChildren(...p.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
    },
    label(text: string): void { q("label").textContent = text; },
  };
}
