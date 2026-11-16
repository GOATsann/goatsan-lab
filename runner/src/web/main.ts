// The playable game in the browser: fixed 60 Hz game ticks, drawing every animation frame.
import { BRAND } from "../brand";
import { TICK_HZ } from "../core/config";
import { Game } from "../core/game";
import { mountHud } from "./hud";
import { Input } from "./input";
import { Renderer } from "./render";

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const $ = (id: string) => document.getElementById(id)!;
document.title = BRAND.gameName;
$("title").textContent = BRAND.gameName;
$("sub").textContent = BRAND.tagline;

const params = new URLSearchParams(location.search);
const fixedSeed = params.has("seed") ? Number(params.get("seed")) : null;
const newSeed = () => fixedSeed ?? Math.floor(Math.random() * 1e9); // UI only: the core never uses Math.random

let game = new Game(newSeed());
let running = false;
let last = performance.now(), acc = 0;
const STEP = 1000 / TICK_HZ;

(window as unknown as { game: () => Game }).game = () => game; // for tests and debugging

function start(): void {
  if (running) return;
  if (game.dead || game.tick > 0) game = new Game(newSeed());
  input.clear();
  running = true;
  $("overlay").hidden = true;
  last = performance.now();
  acc = 0;
}
input.onStart = start;

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

const hudView = mountHud(document.body);
const hud = () => hudView.update(game);

function frame(now: number): void {
  if (running) {
    acc += Math.min(250, now - last);
    while (acc >= STEP && !game.dead) {
      game.step(input.next());
      acc -= STEP;
    }
    if (game.dead) {
      running = false;
      $("title").textContent = `${game.score} points`;
      $("sub").textContent = `${game.meters} m, ${game.coins} coins · ${game.deathCause}`;
      $("overlay").hidden = false;
    }
  }
  last = now;
  renderer.draw(game);
  hud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
