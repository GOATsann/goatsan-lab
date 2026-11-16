// The playable game: start screen (runner + name), fixed 60 Hz game ticks, a frame drawn every animation frame.
import { BRAND } from "../brand";
import { TICK_HZ } from "../core/config";
import { Game } from "../core/game";
import { loadCharacters, makeCharacter, type CharacterInfo, type CharacterView } from "./character";
import { Sfx } from "./audio";
import { clearPending, fetchBoard, readPending, saveScore, signInToSave, type SaveOutcome } from "./scores";
import { mountSoundControls } from "./sound-controls";
import { mountHud } from "./hud";
import { Input } from "./input";
import { Renderer } from "./render";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get: (k: string) => { try { return localStorage.getItem(`lights-out:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`lights-out:${k}`, v); } catch { /* private mode */ } },
};

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const params = new URLSearchParams(location.search);
const fixedSeed = params.has("seed") ? Number(params.get("seed")) : null;
const newSeed = () => fixedSeed ?? Math.floor(Math.random() * 1e9); // UI only: the core never uses Math.random

// start level: Easy / Normal / Hard (the difficulty ramp builds on top)
let level = (Number(store.get("level") ?? 1) || 0) as 0 | 1 | 2;
if (![0, 1, 2].includes(level)) level = 1;
let game = new Game(newSeed(), { level });
const renderer = new Renderer(canvas, { seed: game.seed });
renderer.endShiftOn = true;
const input = new Input(canvas);
const hud = mountHud(document.body, "", { debug: params.has("debug") });
document.title = BRAND.gameName;
$("title").textContent = BRAND.gameName;
$("sub").textContent = BRAND.tagline;
(window as unknown as { game: () => Game }).game = () => game; // for tests and debugging

// ---- runner and name
let characters: CharacterInfo[] = [];
const views = new Map<string, Promise<CharacterView>>();
let charIndex = 0;
const nameInput = $<HTMLInputElement>("name");
nameInput.value = store.get("name") ?? "";
nameInput.addEventListener("input", () => store.set("name", nameInput.value.trim()));
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); e.stopPropagation(); });
const playerName = () => nameInput.value.trim() || "Player";

async function showCharacter(i: number): Promise<void> {
  charIndex = (i + characters.length) % characters.length;
  const info = characters[charIndex];
  store.set("runner", info.id);
  $("charName").textContent = info.name;
  document.documentElement.style.setProperty("--accent", info.colors.accent);
  if (!views.has(info.id)) views.set(info.id, makeCharacter(info));
  const view = await views.get(info.id)!;
  if (characters[charIndex].id === info.id) renderer.setCharacter(view);
}
$("prev").addEventListener("click", () => showCharacter(charIndex - 1));
$("next").addEventListener("click", () => showCharacter(charIndex + 1));
loadCharacters().then((list) => {
  characters = list;
  const saved = list.findIndex((c) => c.id === store.get("runner"));
  showCharacter(saved >= 0 ? saved : 0);
});

// ---- sound: effects and music are separate switches (remembered); M = master mute
const sfx = new Sfx();
(window as unknown as { sfx: Sfx }).sfx = sfx; // for tests
mountSoundControls(sfx, () => document.activeElement === nameInput);

// ---- game loop
let running = false;
let last = performance.now(), acc = 0;
const STEP = 1000 / TICK_HZ;

function start(): void {
  if (running) return;
  if (game.dead || game.tick > 0 || game.options.level !== level) game = new Game(newSeed(), { level });
  input.clear();
  running = true;
  $("overlay").classList.remove("compact");
  $("saveRow").hidden = true;
  $("overlay").hidden = true;
  hud.label(playerName());
  sfx.reset(game);
  last = performance.now();
  acc = 0;
}
input.onStart = () => { if ($("overlay").hidden === false && document.activeElement === nameInput) return; start(); };
$("play").addEventListener("click", start);
$("more").addEventListener("click", () => $("overlay").classList.remove("compact"));
// Race the AI: same track and level for both; the race page reads runner, name and level from storage
$("race").hidden = false;
// Watch the AI: the AI for the chosen level plays alone on that level's track
$("watch").addEventListener("click", () => {
  location.href = `/watch.html?level=${level}`;
});
$("race").addEventListener("click", () => { store.set("name", nameInput.value.trim()); location.href = "/race.html"; });
const levelButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-level]")];
function showLevel(): void {
  for (const b of levelButtons) b.setAttribute("aria-checked", String(Number(b.dataset.level) === level));
}
for (const b of levelButtons) b.addEventListener("click", () => {
  level = Number(b.dataset.level) as 0 | 1 | 2;
  store.set("level", String(level));
  showLevel();
});
showLevel();

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

function frame(now: number): void {
  if (running) {
    acc += Math.min(250, now - last);
    while (acc >= STEP && !game.dead) {
      game.step(input.next());
      acc -= STEP;
    }
    if (game.dead) {
      running = false;
      const caught = game.deathCause === "caught";
      $("title").textContent = `${game.score} points`;
      $("sub").textContent = `${game.meters} m, ${game.coins} coins · ${caught ? "the Blackout caught you" : `hit a ${game.deathCause.replace(" front", "")}`}`;
      $("play").textContent = "Run again";
      showSave(game);
      $("overlay").classList.add("compact"); // just the result and the two buttons; settings fold away
      // every run end: the ghost circles you and the stars spin for a moment, then the card
      setTimeout(() => { $("overlay").hidden = false; }, 1900);
    }
  }
  last = now;
  renderer.draw(game);
  hud.update(game);
  sfx.update(game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- save score + leaderboard (playing never needs an account; saving does)
const LEVEL_WORDS = ["Easy", "Normal", "Hard"];
let lastRun: Game | null = null;

function showSave(g: Game): void {
  lastRun = g;
  $("saveRow").hidden = false;
  $<HTMLButtonElement>("save").disabled = false;
  $("save").textContent = "Save score";
  $("saveMsg").textContent = "";
}

function describe(o: SaveOutcome): string {
  if (!o.ok) return o.signIn ? "Sign in to save your score." : o.message;
  const r = o.result, board = LEVEL_WORDS[r.level];
  const rank = r.rank ? `, number ${r.rank} on the ${board} board` : ` on the ${board} board`;
  return r.improved ? `Saved! Your best is now ${r.best}${rank}.` : `Saved. Your best is still ${r.best}${rank}.`;
}

$("save").addEventListener("click", async () => {
  if (!lastRun) return;
  const name = nameInput.value.trim();
  if (!name) {
    $("overlay").classList.remove("compact"); // show the name field
    $("saveMsg").textContent = "Type your name first, so the board can show it.";
    nameInput.focus();
    return;
  }
  const btn = $<HTMLButtonElement>("save");
  btn.disabled = true;
  btn.textContent = "Saving…";
  const outcome = await saveScore(name, lastRun.replay());
  if (!outcome.ok && outcome.signIn) {
    $("saveMsg").textContent = "Taking you to sign in. Your run will be saved when you come back.";
    signInToSave(name, lastRun.replay());
    return;
  }
  $("saveMsg").textContent = describe(outcome);
  btn.textContent = outcome.ok ? "Saved" : "Try again";
  btn.disabled = outcome.ok;
});

// a run waiting to be saved (back from signing in, or a sign-in that lost its way): try it on every load.
// Saved -> say so. Still signed out -> keep it and offer to sign in (no automatic redirect). Rejected -> drop it.
const pending = readPending();
if (pending) {
  const toast = $("toast");
  toast.hidden = false;
  toast.textContent = "Saving your last run…";
  saveScore(pending.name, pending.replay).then((o) => {
    if (!o.ok && o.signIn) {
      toast.textContent = "Sign in to save your last run. ";
      const go = document.createElement("button");
      go.className = "toast-btn";
      go.textContent = "Sign in";
      go.addEventListener("click", () => signInToSave(pending.name, pending.replay));
      toast.appendChild(go);
      return;
    }
    if (o.ok || !o.message.includes("reach")) clearPending(); // saved, or rejected for good; keep it if the network failed
    toast.textContent = describe(o);
    setTimeout(() => { toast.hidden = true; }, 6000);
  });
}

// the leaderboard: one board per level, opened from the start or game-over card
let boardLevel: number = level;
async function showBoard(l: number): Promise<void> {
  boardLevel = l;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-board]")) b.setAttribute("aria-checked", String(Number(b.dataset.board) === l));
  const list = $("boardList");
  list.innerHTML = '<li class="empty">Loading…</li>';
  $("boardMe").textContent = "";
  const board = await fetchBoard(l);
  if (boardLevel !== l) return;
  if (!board) { list.innerHTML = '<li class="empty">The leaderboard can\'t be reached right now.</li>'; return; }
  if (!board.top.length) { list.innerHTML = `<li class="empty">No scores on the ${LEVEL_WORDS[l]} board yet. Be the first!</li>`; }
  else list.replaceChildren(...board.top.map((e) => {
    const li = document.createElement("li");
    li.innerHTML = "<b></b><span></span><span></span>";
    li.children[0].textContent = String(e.rank);
    li.children[1].textContent = e.name; // text, never HTML: names come from players
    li.children[2].textContent = String(e.score);
    return li;
  }));
  $("boardMe").textContent = board.me ? `Your best here: ${board.me.best}${board.me.rank ? `, number ${board.me.rank}` : ""}.` : "";
}
$("boardBtn").addEventListener("click", () => { $("board").hidden = false; void showBoard(level); });
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-board]")) b.addEventListener("click", () => void showBoard(Number(b.dataset.board)));
$("boardClose").addEventListener("click", () => { $("board").hidden = true; });
