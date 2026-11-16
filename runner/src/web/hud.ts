// The in-run display, shared by the game page and the replay/video page.
//   top left: score (+ the chaser icon when the ghost is close)
//   top right: distance and coins
//   top centre: active power-ups, big, each with a draining ring; they blink in the last 2 s
//   debug (?debug, replays, videos): the track number and a label
import * as C from "../core/config";
import type { Game } from "../core/game";

const BOOSTERS = [
  { key: "magnetTicks", name: "Magnet", total: C.POWER_TICKS, color: "#4fe3ff",
    icon: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z" fill="currentColor"/><path d="M6 4h4v3H6zM14 4h4v3h-4z" fill="#fff"/>' },
  { key: "springTicks", name: "Spring shoes", total: C.POWER_TICKS, color: "#7dff6a",
    icon: '<path d="M4 17h11l4 2v2H4z" fill="currentColor"/><path d="M8 15c0-2 6-2 6-4s-6-2-6-4 6-2 6-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { key: "shieldTicks", name: "Shield", total: C.SHIELD_TICKS, color: "#9fd8ff",
    icon: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="currentColor"/>' },
  { key: "doubleTicks", name: "x2 coins", total: C.POWER_TICKS, color: "#ff4fd8",
    icon: '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="800" font-family="system-ui" fill="currentColor">x2</text>' },
] as const;
const ENDING = 2 * C.TICK_HZ; // blink in the last 2 s

const COIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#ffc93c" stroke="#fff1b0" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="#c8901a" stroke-width="1.5"/></svg>';

export function mountHud(root: HTMLElement, label = "", opts: { debug?: boolean } = {}) {
  root.insertAdjacentHTML("beforeend", `
    <div class="danger" data-danger></div>
    <div class="hud">
      <div><small>score</small><b data-score>0</b></div>
      <div class="right"><span class="dist" data-meters>0 m</span><span class="coins">${COIN_ICON}<b data-coins>0</b></span>
        <small class="debug" data-seed></small><small class="debug" data-label></small></div>
    </div>
    <div class="boosters" data-boosters></div>
    <div class="chaser" data-chaser hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a8 8 0 0 0-8 8v11l2.7-2 2.6 2 2.7-2 2.7 2 2.6-2L20 21V10a8 8 0 0 0-8-8z" fill="#0b0c1c" stroke="#ffd36a" stroke-width="1.2"/><circle cx="9" cy="10" r="1.6" fill="#ffd36a"/><circle cx="15" cy="10" r="1.6" fill="#ffd36a"/></svg><span data-pips></span></div>`);
  const q = (s: string) => root.querySelector(`[data-${s}]`) as HTMLElement;
  root.querySelectorAll<HTMLElement>(".debug").forEach((e) => { e.hidden = !opts.debug; });
  q("label").textContent = label;

  // one element per booster, created once and shown/hidden (no rebuilding every frame)
  const boosterEls = BOOSTERS.map((b) => {
    const el = document.createElement("div");
    el.className = "booster";
    el.style.setProperty("--c", b.color);
    el.innerHTML = `<div class="ring"><svg viewBox="0 0 24 24" aria-hidden="true">${b.icon}</svg></div><span>${b.name}</span>`;
    el.hidden = true;
    q("boosters").appendChild(el);
    return el;
  });

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
      q("meters").textContent = `${g.meters} m`;
      q("coins").textContent = String(g.coins);
      q("seed").textContent = `track ${g.seed}`;
      BOOSTERS.forEach((b, i) => {
        const left = g.dead ? 0 : g[b.key];
        const el = boosterEls[i];
        el.hidden = left <= 0;
        if (left > 0) {
          el.style.setProperty("--p", String(left / b.total));
          el.classList.toggle("ending", left < ENDING);
        }
      });
    },
    label(text: string): void { q("label").textContent = text; },
  };
}
