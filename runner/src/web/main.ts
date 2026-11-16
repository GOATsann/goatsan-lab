// The playable game: start screen (runner + name), fixed 60 Hz game ticks, a frame drawn every animation frame.
import { BRAND } from "../brand";
import { TICK_HZ } from "../core/config";
import { Game } from "../core/game";
import { loadCharacters, makeCharacter, type CharacterInfo, type CharacterView } from "./character";
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

let game = new Game(newSeed());
const renderer = new Renderer(canvas, { seed: game.seed });
const input = new Input(canvas);
const hud = mountHud(document.body);
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

// ---- game loop
let running = false;
let last = performance.now(), acc = 0;
const STEP = 1000 / TICK_HZ;

function start(): void {
  if (running) return;
  if (game.dead || game.tick > 0) game = new Game(newSeed());
  input.clear();
  running = true;
  hud.blackoutDone = false;
  $("overlay").hidden = true;
  hud.label(playerName());
  last = performance.now();
  acc = 0;
}
input.onStart = () => { if ($("overlay").hidden === false && document.activeElement === nameInput) return; start(); };
$("play").addEventListener("click", start);

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
      // caught: ~1 s of full blackout, then it fades out and the card appears
      setTimeout(() => { hud.blackoutDone = true; }, caught ? 1000 : 0);
      setTimeout(() => { $("overlay").hidden = false; }, caught ? 1300 : 600);
    }
  }
  last = now;
  renderer.draw(game);
  hud.update(game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
