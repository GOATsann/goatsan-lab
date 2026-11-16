// Race the AI: two games on the same track (same seed, same level), side by side or stacked.
// The human plays one; the AI driver plays the other at 15 decisions per second, like in training.
import { DECISION_TICKS, TICK_HZ } from "../core/config";
import { Game, NOOP, type Action } from "../core/game";
import { Rng } from "../core/rng";
import { loadAi, type AiDriver } from "./ai";
import { Sfx } from "./audio";
import { mountSoundControls } from "./sound-controls";
import { loadCharacters, makeCharacter } from "./character";
import { Input } from "./input";
import { Renderer } from "./render";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get: (k: string) => { try { return localStorage.getItem(`lights-out:${k}`); } catch { return null; } },
};
const params = new URLSearchParams(location.search);
const level = Math.max(0, Math.min(2, Number(store.get("level") ?? 1) || 0)) as 0 | 1 | 2;
const name = (store.get("name") || "You").slice(0, 16);
const phone = Math.min(window.innerWidth, window.innerHeight) < 700;

const youR = new Renderer($<HTMLCanvasElement>("youCanvas"), { bloom: !phone });
const aiR = new Renderer($<HTMLCanvasElement>("aiCanvas"), { bloom: !phone });
const input = new Input($("youHalf")); // swipes only on your half; keys anywhere
const sfx = new Sfx();
mountSoundControls(sfx);

let you: Game, ai: Game, driver: AiDriver | null = null;
let phase: "loading" | "count" | "race" | "done" = "loading";
let clock = 0; // race time in ticks; both games follow it
let aiReady: { tick: number; action: Action } | null = null, aiThinking = false;
(window as unknown as { race: () => unknown }).race = () => ({ you, ai, phase, clock, driver: driver?.label }); // for tests

function resize(): void {
  for (const [r, half] of [[youR, $("youHalf")], [aiR, $("aiHalf")]] as const) r.resize(half.clientWidth, half.clientHeight);
}
window.addEventListener("resize", resize);
resize();

async function setup(): Promise<void> {
  const seed = params.has("seed") ? Number(params.get("seed")) : Math.floor(Math.random() * 1e9); // UI only
  you = new Game(seed, { level });
  ai = new Game(seed, { level });
  clock = 0;
  aiReady = null;
  const chars = await loadCharacters();
  const mine = chars.find((c) => c.id === store.get("runner")) ?? chars[0];
  const theirs = chars[new Rng(seed).int(chars.length)]; // the AI's runner, random from the two
  youR.setCharacter(await makeCharacter(mine));
  aiR.setCharacter(await makeCharacter(theirs));
  $("youName").textContent = name;
  $("youRunner").textContent = mine.name;
  $("youDot").style.setProperty("--c", mine.colors.accent);
  $("aiName").textContent = "AI";
  $("aiRunner").textContent = theirs.name;
  $("aiDot").style.setProperty("--c", theirs.colors.accent);
  driver ??= await loadAi((["easy", "normal", "hard"] as const)[level]);
  input.clear();
  sfx.reset(you);
  countdown();
}

function countdown(): void {
  phase = "count";
  const el = $("count");
  el.hidden = false;
  let n = 3;
  el.textContent = String(n);
  const tick = () => {
    n--;
    if (n > 0) {
      el.textContent = String(n);
      setTimeout(tick, 700);
    } else {
      el.textContent = "GO";
      setTimeout(() => { el.hidden = true; }, 500);
      phase = "race";
      last = performance.now();
      acc = 0;
    }
  };
  setTimeout(tick, 700);
}

/** Ask the driver for the action at this decision. Sync drivers answer at once (no lag). */
function aiThink(): void {
  if (aiThinking || ai.dead || !driver) return;
  const tick = ai.tick;
  const r = driver.act(ai);
  if (r instanceof Promise) {
    aiThinking = true;
    r.then((action) => { aiReady = { tick, action }; aiThinking = false; });
  } else aiReady = { tick, action: r };
}

/** Step the AI up to the race clock. At each decision it waits for its answer, as in training:
 *  the action is chosen from what it sees at that exact tick, then held for the decision. */
function advanceAi(): void {
  while (!ai.dead && ai.tick < clock) {
    if (ai.tick % DECISION_TICKS === 0) {
      if (!aiReady || aiReady.tick !== ai.tick) { aiThink(); if (!aiReady || aiReady.tick !== ai.tick) return; }
      const a = aiReady.action;
      aiReady = null;
      ai.step(a);
    } else ai.step(NOOP);
  }
}

/** The winner, once it can no longer change; null while it still can. */
function result(): "you" | "ai" | "tie" | null {
  if (you.dead && ai.dead) return you.score > ai.score ? "you" : ai.score > you.score ? "ai" : "tie";
  if (you.dead && ai.score > you.score) return "ai";
  if (ai.dead && you.score > ai.score) return "you";
  return null;
}

function finish(winner: "you" | "ai" | "tie"): void {
  phase = "done";
  $("title").textContent = winner === "you" ? "You win!" : winner === "ai" ? "The AI wins" : "A tie";
  $("sub").textContent = `${name} ${you.score} · AI ${ai.score} (${driver?.label ?? "AI"})`;
  setTimeout(() => { $("overlay").hidden = false; }, 1900);
}

$("again").addEventListener("click", () => {
  $("overlay").hidden = true;
  $("youOut").hidden = $("aiOut").hidden = true;
  setup();
});
$("back").addEventListener("click", () => { location.href = "/"; });

let last = performance.now(), acc = 0;
const STEP = 1000 / TICK_HZ;
function frame(now: number): void {
  if (phase === "race") {
    acc += Math.min(250, now - last);
    while (acc >= STEP && phase === "race") {
      clock++;
      if (!you.dead) you.step(input.next());
      advanceAi();
      acc -= STEP;
      const r = result();
      if (r) finish(r);
    }
    advanceAi(); // catch up after an async answer
  }
  last = now;
  if (you && ai) {
    youR.draw(you);
    aiR.draw(ai);
    $("youScore").textContent = String(you.score);
    $("aiScore").textContent = String(ai.score);
    for (const [g, id] of [[you, "youOut"], [ai, "aiOut"]] as const) {
      const out = $(id);
      out.hidden = !g.dead;
      if (g.dead) out.textContent = g.deathCause === "caught" ? "caught by the Blackout" : "crashed";
    }
    sfx.update(you);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setup();
