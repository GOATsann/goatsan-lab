// Watch the AI: the trained policy plays alone, full screen, in real time (local demo page).
//   /watch.html?level=2&seed=1042   (seed fixed = the same run every time; otherwise a new track each run)
// The AI is the same opponent as in Race the AI for that level. No player controls: the AI plays.
// It restarts by itself after the crash scene. "Hide" (or H) hides the panel for filming; a tap or
// H brings it back.
import { DECISION_TICKS, TICK_HZ } from "../core/config";
import { Game, NOOP, type Action } from "../core/game";
import { Rng } from "../core/rng";
import { loadAi, type AiDriver } from "./ai";
import { Sfx } from "./audio";
import { loadCharacters, makeCharacter } from "./character";
import { mountHud } from "./hud";
import { Renderer } from "./render";
import { mountSoundControls } from "./sound-controls";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const LEVELS = ["easy", "normal", "hard"] as const;
let level = Math.max(0, Math.min(2, Number(params.get("level") ?? 2) || 0)) as 0 | 1 | 2;
const fixedSeed = params.has("seed") ? Number(params.get("seed")) : null;

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const renderer = new Renderer(canvas);
renderer.endShiftOn = false;
const hud = mountHud(document.body, "", { debug: false });
const sfx = new Sfx();
mountSoundControls(sfx);
const resize = () => renderer.resize(innerWidth, innerHeight);
addEventListener("resize", resize);
resize();

let game = new Game(fixedSeed ?? 1, { level });
let driver: AiDriver | null = null;
let ready: { tick: number; action: Action } | null = null, thinking = false;
let runs = 0, best = 0, lastAction: Action = NOOP, restartAt = 0;
(window as unknown as { watch: () => unknown }).watch = () => ({ game, runs, best, driver: driver?.label, lastAction }); // for tests

$<HTMLSelectElement>("level").value = String(level);
// one choice: the level sets the track and the AI opponent, exactly as in Race the AI
$("level").addEventListener("change", async (e) => { level = Number((e.target as HTMLSelectElement).value) as 0 | 1 | 2; driver = await loadAi(LEVELS[level]); newRun(); });
const setHidden = (h: boolean) => { $("panel").hidden = h; };
addEventListener("keydown", (e) => { if (e.key === "h" || e.key === "H") setHidden(!$("panel").hidden); });
$("hide").addEventListener("click", (e) => { e.stopPropagation(); setHidden(true); });
canvas.addEventListener("click", () => setHidden(false));

function newRun(): void {
  runs++;
  const seed = fixedSeed ?? new Rng((Date.now() ^ (runs * 0x9e3779b9)) >>> 0).next(); // UI only
  game = new Game(seed, { level });
  ready = null;
  restartAt = 0;
  sfx.reset(game);
  $("run").textContent = String(runs);
}

function think(): void {
  if (thinking || !driver) return;
  const tick = game.tick;
  const r = driver.act(game);
  if (r instanceof Promise) { thinking = true; r.then((action) => { ready = { tick, action }; thinking = false; }); }
  else ready = { tick, action: r };
}

let last = performance.now(), acc = 0;
const STEP = 1000 / TICK_HZ;
function frame(now: number): void {
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    if (game.dead) continue;
    // one decision every 4 ticks, chosen from what the AI sees at that exact tick (as in training)
    if (game.tick % DECISION_TICKS === 0) {
      // answer not back yet: keep this tick's time and catch up next frame (no slow motion)
      if (!ready || ready.tick !== game.tick) { think(); if (!ready || ready.tick !== game.tick) { acc += STEP; break; } }
      lastAction = ready.action;
      ready = null;
      game.step(lastAction);
    } else game.step(NOOP);
  }
  if (game.dead) {
    best = Math.max(best, game.score);
    $("best").textContent = String(best);
    if (!restartAt) restartAt = now + 3500; // let the crash scene play
    else if (now >= restartAt) newRun();
  }
  renderer.draw(game);
  hud.update(game);
  sfx.update(game);
  requestAnimationFrame(frame);
}

(async () => {
  driver = await loadAi(LEVELS[level]);
  const chars = await loadCharacters();
  renderer.setCharacter(await makeCharacter(chars[new Rng(fixedSeed ?? Date.now()).int(chars.length)]));
  newRun();
  requestAnimationFrame(frame);
})();
