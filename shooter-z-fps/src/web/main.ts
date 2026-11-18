// Shooter Z in the browser: menu, playing (first person, pointer lock), watching AI vs AI (spectator
// cameras), free camera for filming. Fixed 60 Hz core ticks; a frame is drawn every animation frame.
import { BRAND } from "../brand";
import { type Action, noop } from "../core/actions";
import type { SkillName } from "../core/bot";
import { CHARACTERS } from "../core/characters";
import { TICK_HZ } from "../core/config";
import { MODES, type GameEvent, type Mode } from "../core/game";
import type { MapId } from "../core/maps";
import { Match, standardSlots, type Slot } from "../core/match";
import { Sfx } from "./audio";
import { GameView, newRig, type CameraRig, type CamMode } from "./gameview";
import { Hud, type HudContext } from "./hud";
import { Input } from "./input";
import { Stage, type Graphics } from "./stage";
import { CharPreview } from "./charpreview";
import { Tutorial, TUTORIAL_MAP } from "./tutorial";
import { TouchControls } from "./touch";
import { loadTrainedModel, retryModelLoad, TrainedAiController, type TrainedModel } from "./trained-ai";
import { RANGE } from "../core/config";
import { cos, sin } from "../core/fmath";
import * as THREE from "three";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const store = {
  get: (k: string) => { try { return localStorage.getItem(`shooter-z:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`shooter-z:${k}`, v); } catch { /* private mode */ } },
};

// phones and tablets: play with touch controls when held sideways, or watch AI vs AI
const touchDevice = params.has("touch") || (matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches);
const phone = params.has("phone") || touchDevice || window.innerWidth < 760;
document.body.classList.toggle("phone", phone);
document.title = `${BRAND.gameName}: ${BRAND.tagline}`;

// ---- settings (remembered)
const settings = {
  mode: (store.get("mode") ?? "duel") as Mode,
  map: (store.get("map") ?? "base") as MapId,
  // touch players start on Easy (they can change it)
  skill: (store.get("skill") ?? (touchDevice ? "easy" : "normal")) as SkillName,
  character: Number(store.get("character") ?? 0),
  limit: Number(store.get("limit") ?? 10),
  // a simple device rule: touch devices default to Low graphics (they can switch to Normal)
  graphics: ((params.get("graphics") ?? store.get("graphics") ?? (touchDevice ? "low" : "normal")) === "low" ? "low" : "normal") as Graphics,
  sens: Number(store.get("sens") ?? 1),
  touchSens: Number(store.get("touchSens") ?? 1),
  // phones: Simple firing (fires while the crosshair is on a visible enemy) or Advanced (manual Fire)
  fireMode: (store.get("fireMode") ?? "simple") as "simple" | "advanced",

};
if (!MODES[settings.mode]) settings.mode = "duel";
if (!(settings.character >= 0 && settings.character < CHARACTERS.length)) settings.character = 0;

const canvas = $<HTMLCanvasElement>("view");
const stage = new Stage(canvas, { graphics: settings.graphics });
const input = new Input(canvas);
input.forceLocked = params.has("autotest");
input.sensitivity = 0.0022 * settings.sens;
const sfx = new Sfx();
const debugFps = params.has("debug") || params.has("fps");
const fixedSeed = params.has("seed") ? Number(params.get("seed")) : null;
const newSeed = () => fixedSeed ?? Math.floor(Math.random() * 1e9); // UI only: the core never uses Math.random

// ---- colours: you are blue; in 2v2 your teammate is teal and the other team orange/red
function slotColors(mode: Mode): string[] {
  if (mode === "team") return ["#3d8bff", "#2fc9b5", "#ff8a2a", "#e2503f"];
  if (mode === "duel") return ["#3d8bff", "#ff8a2a"];
  return ["#3d8bff", "#ff8a2a", "#7bd04b", "#d65ad8"];
}

// ------------------------------------------------------------------------------------- session
interface Session {
  match: Match;
  view: GameView;
  hud: Hud;
  rig: CameraRig;
  spectator: boolean;
  self: number; // the human's slot, or -1
  colors: string[];
  slots: Slot[];
  endedAt: number;
  backdrop: boolean; // the live match behind the menu
  tutorial: Tutorial | null;
  /** the trained AI driving the "external" robots, if any */
  ai: TrainedAiController | null;
}

// ---- the trained AI plays every robot that isn't you (opponents, 2v2 teammate, Watch AI vs AI).
// The hand-written rule bots are for testing and training only: the ?rulebots dev flag (not in the UI).
const ruleBots = params.has("rulebots");
let aiModel: TrainedModel | null = null;
let aiState: "idle" | "loading" | "ready" | "error" = "idle";
const wantAI = () => !ruleBots;
/** Load the model (once; the menu's Retry tries again after a failure). */
async function ensureAI(): Promise<void> {
  if (!wantAI() || aiModel) return;
  aiState = "loading"; showAiState();
  aiModel = await loadTrainedModel();
  aiState = aiModel ? "ready" : "error";
  showAiState();
  // the menu's live backdrop switches to the AI as soon as it's here
  if (aiModel && state === "menu" && S?.backdrop && !S.ai) startMatch("backdrop", settings.map);
}
function showAiState(): void {
  const el = $("aiStatus");
  const wait = wantAI() && aiState !== "ready";
  document.body.classList.toggle("ai-wait", wait);
  el.hidden = !wait;
  el.classList.toggle("error", aiState === "error");
  $("aiStatusText").textContent = aiState === "error" ? "Couldn't load the AI." : "Loading the AI...";
  $("aiRetry").hidden = aiState !== "error";
}
let S: Session | null = null;
let state: "menu" | "play" | "watch" = "menu";
let hudVisible = true;
/** playing with touch controls (phone held sideways) */
let touchPlay = false;
let touchPaused = false;
let touch: TouchControls | null = null;
let autoDirector = true;
const idle: Action = noop();

function startMatch(kind: "play" | "watch" | "backdrop" | "tutorial", mapOverride?: MapId): void {
  if (S) { S.hud.root.remove(); S.tutorial?.el.remove(); }
  touch?.remove();
  touch = null;
  touchPaused = false;
  const touching = touchPlay && (kind === "play" || kind === "tutorial");
  document.body.classList.toggle("touchplay", touching);
  $("touchEnd").hidden = true;
  stage.reset();
  const seed = newSeed();
  const spectate = kind === "watch" || kind === "backdrop";
  const tut = kind === "tutorial";
  const mode = kind === "backdrop" ? "ffa" : tut ? "duel" : settings.mode;
  const map = tut ? TUTORIAL_MAP : mapOverride ?? settings.map;
  const slots = standardSlots(mode, kind === "backdrop" ? "normal" : tut ? "training" : settings.skill, { spectate, seed, character: settings.character });
  if (tut) slots[1].name = "Training target"; // tutorial scripting, not an opponent
  // the trained AI plays every non-human robot (both sides when watching AI vs AI)
  const useAI = wantAI() && kind !== "tutorial";
  const aiSlots: number[] = [];
  // (until the model is here, the menu backdrop's robots just stand still: never rule bots on screen)
  if (useAI) slots.forEach((sl, i) => { if (sl.kind === "bot") { slots[i] = { kind: "external", name: sl.name, character: sl.character }; aiSlots.push(i); } });
  const match = new Match(seed, { map, mode, scoreLimit: kind === "backdrop" ? 50 : tut ? 999 : settings.limit, slots });
  const ai = useAI && aiModel && aiSlots.length ? new TrainedAiController(aiModel, match, aiSlots) : null;
  const colors = slotColors(mode);
  const self = spectate ? -1 : 0;
  const view = new GameView(stage, match, { look: "final", self, colors });
  const hud = new Hud(document.body, debugFps);
  const rig = newRig();
  rig.mode = spectate ? (kind === "backdrop" ? "overview" : "follow") : "fp";
  rig.target = 0;
  const tutorial = tut ? new Tutorial(match, settings.character, touching ? document.body : hud.root, touching, touching && settings.fireMode === "simple") : null;
  if (touching) {
    touch = new TouchControls(document.body, input, {
      lookSpeed: 0.006 * settings.touchSens,
      simple: settings.fireMode === "simple",
      onPause: () => { touchPaused = true; pausedByUser = true; touch?.reset(); },
    });
  }
  hud.tutorial = tut;
  S = { match, view, hud, rig, spectator: spectate, self, colors, slots, endedAt: -1, backdrop: kind === "backdrop", tutorial, ai };
  if (tutorial) view.snapshot();
  hud.setVisible(kind !== "backdrop" && hudVisible);
  (window as unknown as { shooterZ: unknown }).shooterZ = { match, view, rig, input, hud, get state() { return state; }, get tutorial() { return S?.tutorial ?? null; }, get touchPaused() { return touchPaused; }, sfx, ai }; // for tests and debugging
  updateSpecBar();
  acc = 0;
  readyCd = 0;
}

function hudCtx(): HudContext {
  const s = S!;
  const viewer = s.rig.mode === "fp" ? s.self : s.rig.mode === "pov" || s.rig.mode === "follow" ? s.rig.target : -1;
  return { game: s.match.game, slots: s.slots, colors: s.colors, self: s.spectator ? viewer : s.self, spectator: s.spectator || s.rig.mode !== "fp" };
}

// ------------------------------------------------------------------------------------- events -> sound
const camPos = new THREE.Vector3();
function onEvents(events: readonly GameEvent[]): void {
  const s = S!;
  s.view.onEvents(events);
  if (!s.backdrop) s.hud.onEvents(events, hudCtx());
  if (s.backdrop) return;
  const g = s.match.game;
  camPos.copy(stage.camera.position);
  const dist = (id: number) => { const a = g.agents[id]; return Math.hypot(a.x - camPos.x, a.y - camPos.y, a.z - camPos.z); };
  const me = s.spectator ? (s.rig.mode === "free" || s.rig.mode === "overview" ? -1 : s.rig.target) : s.self;
  for (const e of events) {
    if (e.type === "shot") sfx.laser(dist(e.a), e.a === me);
    else if (e.type === "hit" && e.a === me) sfx.hit(e.part === "head");
    else if (e.type === "hit" && e.v === me && !e.blocked) sfx.hurt();
    else if (e.type === "kill") { if (e.a === me) sfx.kill(); sfx.eliminated(dist(e.v)); }
    else if (e.type === "reload" && e.a === me) sfx.reload();
    else if (e.type === "jump" && e.a === me) sfx.jump();
    else if (e.type === "spawn" && e.a === me) sfx.spawn();
    else if (e.type === "ability" && (e.a === me || dist(e.a) < 45)) {
      // you can hear another robot's Special Move nearby, from where it is (fair: a player would too)
      const a = g.agents[e.a];
      sfx.special(e.kind, e.a === me, { x: a.x, y: a.y + 1.2, z: a.z });
    }
    // spectator auto-director: cut to whoever just made an elimination
    if (e.type === "kill" && s.spectator && autoDirector && (s.rig.mode === "follow" || s.rig.mode === "pov")) {
      const killer = e.a;
      // if the robot we're watching went down, let its death cam play before cutting to the killer
      const wait = e.v === s.rig.target ? 2300 : 900;
      setTimeout(() => { if (S === s && autoDirector) { s.rig.target = killer; updateSpecBar(); } }, wait);
    }
  }
}

// ------------------------------------------------------------------------------------- loop
const STEP = 1000 / TICK_HZ;
let acc = 0, last = performance.now();
let readyCd = 0;
const proj = new THREE.Vector3();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;
  if (!S) return;
  const s = S;
  const g = s.match.game;
  const paused = state === "play" && !g.over && (touchPlay ? touchPaused : !input.locked);
  $("pause").hidden = !(paused && pausedByUser);
  $("clickHint").hidden = touchPlay || !(state === "play" && !input.locked && !pausedByUser && !g.over);
  if (touchPlay && state === "play") $("touchEnd").hidden = !(g.over || !!s.tutorial?.done);
  if (!paused && !g.over) {
    acc += dtMs;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      if (touch) input.touch.autoFire = touch.autoFire && crosshairOnEnemy(s);
      // the trained AI decides every few ticks; wait for it (a millisecond or two) rather than skip a decision
      const ext: (Action | null)[] = [];
      if (s.ai && !s.ai.ready(ext)) break;
      if (s.self >= 0) ext[s.self] = s.rig.mode === "fp" ? input.action() : idle;
      s.view.snapshot();
      s.match.step(ext);
      s.ai?.afterTick();
      onEvents(g.events);
      // a quiet chime when your Special Move is ready again
      if (s.self >= 0) {
        const me = g.agents[s.self];
        const respawned = g.events.some((e) => e.type === "spawn" && e.a === s.self);
        if (me.alive && !respawned && readyCd > 0 && me.abilityCooldown === 0) sfx.ready();
        readyCd = me.abilityCooldown;
      }
      if (s.tutorial && !s.tutorial.done) {
        s.tutorial.update(g.events, STEP / 1000);
        if (s.tutorial.done) store.set("tutorialDone", "1");
      }
      acc -= STEP;
      steps++;
    }
    if (steps === 6) acc = 0; // fell far behind (tab was hidden): don't fast-forward
  }
  touch?.update(s.self >= 0 ? g.agents[s.self] : null);
  // cameras
  if (s.rig.mode === "fp") {
    s.rig.pendingYaw = input.pendingYaw();
    s.rig.pendingPitch = input.pendingPitch();
  } else if (s.rig.mode === "free") flyFree(s.rig, dt);
  s.view.render(paused || g.over ? 1 : acc / STEP, dt, s.rig);
  {
    // the listener is the camera (positional Special Move sounds)
    const c = stage.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    sfx.setListener(c.position.x, c.position.y, c.position.z, f.x, f.y, f.z);
  }
  if (!s.backdrop) {
    const cam = stage.camera;
    const w = window.innerWidth, h = window.innerHeight;
    s.hud.update(dt, hudCtx(), (x, y, z) => {
      proj.set(x, y, z).project(cam);
      if (proj.z > 1) return null;
      return { x: (proj.x * 0.5 + 0.5) * w, y: (-proj.y * 0.5 + 0.5) * h };
    }, cam.rotation.y);
  }
  // end of match
  if (g.over && s.endedAt < 0) {
    s.endedAt = now;
    if (state === "play") input.unlock();
  }
  if (g.over && s.spectator && now - s.endedAt > 7000) {
    // next AI vs AI match, the other map
    startMatch(s.backdrop ? "backdrop" : "watch", g.map.id === "base" ? "ship" : "base");
  }
}
requestAnimationFrame(frame);

/** Simple firing (touch): is the crosshair on an enemy you can see right now? */
function crosshairOnEnemy(s: Session): boolean {
  const g = s.match.game, me = g.agents[s.self];
  if (!me.alive) return false;
  const cp = cos(me.pitch);
  const hit = g.trace(me.id, me.x, g.eyeY(me), me.z, -sin(me.yaw) * cp, sin(me.pitch), -cos(me.yaw) * cp, RANGE, true);
  return hit.agent >= 0 && g.isEnemy(me.id, hit.agent);
}

/** Phones: fullscreen and landscape lock where the browser allows it (needs the tap that started play). */
function goFullscreen(): void {
  if (params.has("nofs")) return; // screen recordings in tests
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const r = el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.();
    Promise.resolve(r).then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("landscape")).catch(() => {});
  } catch { /* not supported (e.g. iPhone Safari): the page still works */ }
}

function startTouch(kind: "play" | "tutorial"): void {
  touchPlay = true;
  input.forceLocked = true;
  sfx.unlock();
  goFullscreen();
  void withAI(() => { hideMenu(); state = "play"; startMatch(kind); });
}

/** Free camera: WASD fly, mouse look (click to lock), Space up, C down, Shift faster. */
function flyFree(rig: CameraRig, dt: number): void {
  const m = input.takeMouse();
  rig.yaw -= m.dx * input.sensitivity;
  rig.pitch = Math.max(-1.5, Math.min(1.5, rig.pitch - m.dy * input.sensitivity));
  const k = input.keys;
  const sp = (k.has("ShiftLeft") || k.has("ShiftRight") ? 16 : 6) * dt;
  const f = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0), r = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
  const u = (k.has("Space") || k.has("KeyE") ? 1 : 0) - (k.has("KeyC") || k.has("KeyQ") ? 1 : 0);
  const cp = Math.cos(rig.pitch);
  rig.x += (-Math.sin(rig.yaw) * cp * f + Math.cos(rig.yaw) * r) * sp;
  rig.z += (-Math.cos(rig.yaw) * cp * f - Math.sin(rig.yaw) * r) * sp;
  rig.y = Math.max(0.3, rig.y + (Math.sin(rig.pitch) * f + u) * sp);
}

function setCam(mode: CamMode): void {
  if (!S) return;
  const rig = S.rig;
  if (mode === "free" && rig.mode !== "free") {
    // start the free camera where the current view is
    const c = stage.camera;
    rig.x = c.position.x; rig.y = c.position.y; rig.z = c.position.z;
    const e = new THREE.Euler().setFromQuaternion(c.quaternion, "YXZ");
    rig.yaw = e.y; rig.pitch = e.x;
  }
  rig.mode = mode;
  updateSpecBar();
}

function updateSpecBar(): void {
  if (!S) return;
  const s = S;
  if (!s.spectator) {
    s.hud.setSpectatorBar(s.rig.mode === "free" ? `<span class="keys">Free camera: WASD fly, mouse look, Space/C up and down, Shift faster. Press V to go back to your robot.</span>` : "");
    return;
  }
  const t = s.rig.target;
  const ch = CHARACTERS[s.match.game.agents[t].character];
  const labels: Record<CamMode, string> = { fp: "", pov: "Robot's eyes", follow: "Follow", free: "Free camera", overview: "Overview" };
  s.hud.setSpectatorBar(`
    <button data-sb="prev" aria-label="Previous robot">&#9664;</button>
    <span class="who" style="--c:${s.colors[t]}">${s.slots[t].name} · ${ch.name}</span>
    <button data-sb="next" aria-label="Next robot">&#9654;</button>
    <button data-sb="cam">${labels[s.rig.mode]}</button>
    <button data-sb="menu">Menu</button>
    ${phone ? "" : `<span class="keys">1-4 pick a robot · F follow · P robot's eyes · O overview · V free camera · Tab scores · H hide HUD · Esc menu</span>`}`);
}

document.body.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-sb]") as HTMLElement | null;
  if (!b || !S) return;
  const s = S, n = s.match.game.n;
  const v = b.dataset.sb;
  if (v === "prev" || v === "next") { s.rig.target = (s.rig.target + (v === "next" ? 1 : n - 1)) % n; autoDirector = false; if (s.rig.mode === "overview" || s.rig.mode === "free") s.rig.mode = "follow"; }
  if (v === "cam") { const order: CamMode[] = ["follow", "pov", "overview", ...(phone ? [] : ["free" as CamMode])]; setCam(order[(order.indexOf(s.rig.mode) + 1) % order.length]); }
  if (v === "menu") showMenu();
  updateSpecBar();
});

// ------------------------------------------------------------------------------------- keys
let pausedByUser = false;
input.onKey = (code) => {
  if (!S || state === "menu") return;
  const s = S;
  if (code === "Tab") s.hud.showBoard = true;
  if (code === "KeyH") { hudVisible = !hudVisible; s.hud.setVisible(hudVisible); }
  if (code === "KeyM") sfx.setMuted(!sfx.muted);
  if (code === "Enter" && state === "play" && (s.match.game.over || s.tutorial?.done)) { lockAndGo(); void withAI(() => { startMatch("play"); state = "play"; }); }
  if (code === "KeyN" && s.tutorial && !s.tutorial.done && state === "play") { s.tutorial.next(); if (s.tutorial.done) store.set("tutorialDone", "1"); }
  if (code === "Escape" && (s.spectator || s.match.game.over || s.tutorial?.done)) showMenu();
  if (state === "play") {
    if (code === "KeyV") setCam(s.rig.mode === "free" ? "fp" : "free");
    return;
  }
  // spectator keys
  const n = s.match.game.n;
  if (code.startsWith("Digit")) { const d = Number(code.slice(5)) - 1; if (d >= 0 && d < n) { s.rig.target = d; autoDirector = false; if (s.rig.mode !== "pov") setCam("follow"); } }
  if (code === "KeyF") setCam("follow");
  if (code === "KeyP") setCam("pov");
  if (code === "KeyO") setCam("overview");
  if (code === "KeyV") setCam(s.rig.mode === "free" ? "follow" : "free");
  if (code === "KeyA" && s.rig.mode !== "free") autoDirector = true;
  updateSpecBar();
};
input.onKeyUp = (code) => { if (code === "Tab" && S) S.hud.showBoard = false; };

document.addEventListener("pointerlockchange", () => {
  if (state === "play" && !input.locked && S && !S.match.game.over) { pausedByUser = true; input.clear(); }
  if (input.locked) pausedByUser = false;
});
canvas.addEventListener("click", () => {
  if (state === "play" || (state === "watch" && S?.rig.mode === "free")) { sfx.unlock(); input.lock(); }
});
$("resume").addEventListener("click", () => { pausedByUser = false; if (touchPlay) touchPaused = false; else lockAndGo(); });
$("playTouch").addEventListener("click", () => startTouch("play"));
$("tutorialTouch").addEventListener("click", () => startTouch("tutorial"));
$("againBtn").addEventListener("click", () => startTouch("play"));
$("menuBtn").addEventListener("click", () => showMenu());
$<HTMLInputElement>("touchSens").value = String(settings.touchSens);
$<HTMLInputElement>("touchSens").addEventListener("input", (e) => { settings.touchSens = Number((e.target as HTMLInputElement).value); store.set("touchSens", String(settings.touchSens)); });
$("quit").addEventListener("click", () => showMenu());

function lockAndGo(): void {
  sfx.unlock();
  input.lock();
}

// ------------------------------------------------------------------------------------- menu
function showMenu(): void {
  input.unlock();
  if (touchPlay) { touchPlay = false; input.forceLocked = params.has("autotest"); }
  $("touchEnd").hidden = true;
  state = "menu";
  pausedByUser = false;
  $("menu").hidden = false;
  $("pause").hidden = true;
  preview.running = true;
  const first = !store.get("tutorialDone");
  $("firstVisit").hidden = !first;
  $("menu").classList.toggle("first", first);
  startMatch("backdrop", settings.map);
}

function hideMenu(): void { $("menu").hidden = true; preview.running = false; }

function refreshMenu(): void {
  for (const seg of document.querySelectorAll<HTMLElement>(".seg[data-setting]")) {
    const key = seg.dataset.setting as "mode" | "map" | "skill" | "graphics" | "limit" | "fireMode";
    seg.setAttribute("role", "radiogroup");
    for (const b of seg.querySelectorAll<HTMLButtonElement>("button")) { b.classList.toggle("on", b.dataset.v === String(settings[key])); b.setAttribute("role", "radio"); }
  }
  const notes: Record<Mode, string> = {
    duel: "You against one AI robot.",
    team: "You and an AI teammate against two AI robots. No friendly fire.",
    ffa: "Free-for-all: you against three AI robots, everyone for themselves.",
  };
  $("modeNote").textContent = notes[settings.mode];

  for (const b of document.querySelectorAll<HTMLButtonElement>("#chars button")) {
    const on = Number(b.dataset.c) === settings.character;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>(".seg[data-setting] button")) b.setAttribute("aria-checked", String(b.classList.contains("on")));
  const ch = CHARACTERS[settings.character];
  if (previewShown !== settings.character) { preview.show(settings.character, CHARACTERS[settings.character].accent); previewShown = settings.character; }
  $("cpName").textContent = ch.name;
  $("cpMove").textContent = ch.abilityName;
  $("charPreview").style.setProperty("--c", ch.accent);
  $("cpDesc").textContent = ch.blurb;
  $("cpCd").textContent = `Cooldown ${Math.round(ch.cooldown / TICK_HZ)} s · press E or right-click`;
  $<HTMLInputElement>("sens").value = String(settings.sens);
}

$("chars").innerHTML = CHARACTERS.map((c) => `<button data-c="${c.id}" role="radio" style="--c:${c.accent}"><b>${c.name}</b><em>${c.abilityName}</em></button>`).join("");
const preview = new CharPreview($<HTMLCanvasElement>("charCanvas"));
let previewShown = -1;
document.querySelector("#chars")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!b) return;
  settings.character = Number(b.dataset.c);
  store.set("character", String(settings.character));
  refreshMenu();
});
for (const seg of document.querySelectorAll<HTMLElement>(".seg[data-setting]")) {
  seg.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!b) return;
    const key = seg.dataset.setting as "mode" | "map" | "skill" | "graphics" | "limit" | "fireMode";
    const v = b.dataset.v!;
    if (key === "graphics") {
      if (v !== settings.graphics) { store.set("graphics", v); location.reload(); }
      return;
    }
    (settings as Record<string, unknown>)[key] = key === "limit" ? Number(v) : v;
    store.set(key, v);
    refreshMenu();
    if (key === "map" && state === "menu") startMatch("backdrop", settings.map);
  });
}
$<HTMLInputElement>("sens").addEventListener("input", (e) => { settings.sens = Number((e.target as HTMLInputElement).value); store.set("sens", String(settings.sens)); input.sensitivity = 0.0022 * settings.sens; });

/** Start once the trained AI is here (Play and Watch are disabled until then; see showAiState). */
async function withAI(go: () => void): Promise<void> {
  if (wantAI() && !aiModel) await ensureAI();
  if (wantAI() && !aiModel) return; // couldn't load: the menu says so and offers Retry
  go();
}
$("aiRetry").addEventListener("click", () => { retryModelLoad(); void ensureAI(); });
$("play").addEventListener("click", () => {
  lockAndGo(); // inside the click: browsers only lock the mouse on a user gesture
  void withAI(() => { hideMenu(); state = "play"; startMatch("play"); });
});
const watch = () => {
  sfx.unlock();
  void withAI(() => { hideMenu(); state = "watch"; autoDirector = true; startMatch("watch"); });
};
$("watch").addEventListener("click", watch);
$("tutorial").addEventListener("click", () => {
  hideMenu();
  state = "play";
  startMatch("tutorial");
  lockAndGo();
});
$("watchPhone").addEventListener("click", watch);

refreshMenu();
// every match needs the trained AI: load it right away (Play and Watch wait for it)
$("levelField").hidden = !ruleBots;
void ensureAI();
if (params.get("start") === "play" && !phone) { hideMenu(); state = "play"; startMatch("play"); }
else if (params.get("start") === "tutorial" && (!phone || params.has("autotest"))) { hideMenu(); state = "play"; startMatch("tutorial"); }
else if (params.get("start") === "watch") watch();
else showMenu();
