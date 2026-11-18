// Touch controls for playing on a phone held sideways. Multi-touch: move with the left thumb-stick, aim
// by dragging anywhere on the right half, and hold Fire at the same time. Buttons sit at the edges, in
// thumb reach, and never cover the crosshair. Feeds the same Input (and so the same core Action) as the
// keyboard and mouse.
import { CHARACTERS } from "../core/characters";
import type { Agent } from "../core/game";
import type { Input } from "./input";

export interface TouchOptions {
  /** radians of turn per pixel dragged */
  lookSpeed: number;
  /** Simple: the game fires while the crosshair is on a visible enemy (no Fire buttons). Advanced: manual Fire. */
  simple: boolean;
  onPause: () => void;
}

// a Fire button also aims: dragging while holding it turns the view (like the big mobile shooters)
type Role = { kind: "stick"; x0: number; y0: number } | { kind: "look"; x: number; y: number } | { kind: "button"; name: string; x: number; y: number };

export class TouchControls {
  readonly el: HTMLElement;
  private input: Input;
  private opts: TouchOptions;
  private roles = new Map<number, Role>();
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private abilityRing: HTMLElement;
  private abilityLabel: HTMLElement;
  private crouchBtn: HTMLElement;
  private crouchOn = false;
  /** auto-fire: fire whenever the crosshair is on an enemy (optional, off by default) */
  autoFire = false;
  autoFireNow = false;

  constructor(parent: HTMLElement, input: Input, opts: TouchOptions) {
    this.input = input;
    this.opts = opts;
    this.el = document.createElement("div");
    this.el.className = "touch";
    this.el.innerHTML = `
      <div class="t-stick" hidden><div class="t-knob"></div></div>
      <button class="t-btn t-pause" data-t="pause" aria-label="Pause">II</button>
      <button class="t-btn t-reload" data-t="reload" aria-label="Reload">R</button>
      <button class="t-btn t-ability" data-t="ability" aria-label="Special Move"><span class="t-ring"></span><span class="t-ab-label">E</span></button>
      <button class="t-btn t-jump" data-t="jump" aria-label="Jump">Jump</button>
      <button class="t-btn t-crouch" data-t="crouch" aria-label="Crouch">Crouch</button>
      <button class="t-btn t-fire" data-t="fire" aria-label="Fire">Fire</button>
      <button class="t-btn t-fire t-fire-left" data-t="fire" aria-label="Fire (left thumb)">Fire</button>
      <div class="t-hint">${opts.simple ? "Left thumb: move · drag right side: aim · it fires when you're on target" : "Left thumb: move · drag right side or Fire: aim"}</div>`;
    this.el.classList.toggle("simple", opts.simple);
    this.autoFire = opts.simple;
    parent.appendChild(this.el);
    this.stickBase = this.el.querySelector(".t-stick")!;
    this.stickKnob = this.el.querySelector(".t-knob")!;
    this.abilityRing = this.el.querySelector(".t-ring")!;
    this.abilityLabel = this.el.querySelector(".t-ab-label")!;
    this.crouchBtn = this.el.querySelector(".t-crouch")!;
    this.el.addEventListener("pointerdown", (e) => this.down(e));
    this.el.addEventListener("pointermove", (e) => this.move(e));
    this.el.addEventListener("pointerup", (e) => this.up(e));
    this.el.addEventListener("pointercancel", (e) => this.up(e));
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    setTimeout(() => this.el.querySelector(".t-hint")?.classList.add("gone"), 5000);
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    const btn = (e.target as HTMLElement).closest("[data-t]") as HTMLElement | null;
    if (btn) {
      const name = btn.dataset.t!;
      this.roles.set(e.pointerId, { kind: "button", name, x: e.clientX, y: e.clientY });
      try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic events in tests */ }
      btn.classList.add("on");
      const t = this.input.touch;
      if (name === "fire") t.fire = true;
      else if (name === "jump") t.jump = true;
      else if (name === "reload") t.reload = true;
      else if (name === "ability") t.ability = true;
      else if (name === "crouch") { this.crouchOn = !this.crouchOn; t.crouch = this.crouchOn; this.crouchBtn.classList.toggle("latched", this.crouchOn); }
      else if (name === "pause") this.opts.onPause();
      return;
    }
    if (e.clientX < window.innerWidth * 0.45) {
      // a floating stick appears under the left thumb
      this.roles.set(e.pointerId, { kind: "stick", x0: e.clientX, y0: e.clientY });
      this.stickBase.hidden = false;
      this.stickBase.style.transform = `translate(${e.clientX - 60}px, ${e.clientY - 60}px)`;
      this.stickKnob.style.transform = "translate(0px, 0px)";
    } else {
      this.roles.set(e.pointerId, { kind: "look", x: e.clientX, y: e.clientY });
    }
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic events in tests */ }
  }

  private move(e: PointerEvent): void {
    const r = this.roles.get(e.pointerId);
    if (!r) return;
    e.preventDefault();
    if (r.kind === "stick") {
      let dx = e.clientX - r.x0, dy = e.clientY - r.y0;
      const len = Math.hypot(dx, dy), max = 55;
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      // the core moves at one speed: a dead zone, then 8 directions
      const nx = dx / max, ny = dy / max;
      this.input.touch.strafe = nx > 0.35 ? 1 : nx < -0.35 ? -1 : 0;
      this.input.touch.forward = ny < -0.35 ? 1 : ny > 0.35 ? -1 : 0;
    } else if (r.kind === "look" || (r.kind === "button" && r.name === "fire")) {
      const dx = e.clientX - r.x, dy = e.clientY - r.y;
      r.x = e.clientX; r.y = e.clientY;
      // turn into "mouse pixels" so the camera and the core get it exactly like mouse movement
      const k = this.opts.lookSpeed / this.input.sensitivity;
      this.input.addMouse(dx * k, dy * k);
    }
  }

  private up(e: PointerEvent): void {
    const r = this.roles.get(e.pointerId);
    this.roles.delete(e.pointerId);
    if (!r) return;
    if (r.kind === "stick") {
      this.stickBase.hidden = true;
      this.input.touch.forward = 0; this.input.touch.strafe = 0;
    } else if (r.kind === "button") {
      for (const b of this.el.querySelectorAll(`[data-t="${r.name}"]`)) b.classList.remove("on");
      const t = this.input.touch;
      // two Fire buttons: keep firing while either is still held
      if (r.name === "fire") t.fire = [...this.roles.values()].some((x) => x.kind === "button" && x.name === "fire");
      else if (r.name === "jump") t.jump = false;
      else if (r.name === "reload") t.reload = false;
      else if (r.name === "ability") t.ability = false;
    }
  }

  /** Every frame: the Special Move button's cooldown ring and name. */
  update(me: Agent | null): void {
    if (!me) return;
    const ch = CHARACTERS[me.character];
    const p = me.abilityCooldown === 0 ? 1 : 1 - me.abilityCooldown / ch.cooldown;
    this.abilityRing.style.setProperty("--p", String(p));
    this.abilityLabel.textContent = me.abilityCooldown === 0 ? ch.abilityName : String(Math.ceil(me.abilityCooldown / 60));
    this.el.querySelector(".t-ability")!.classList.toggle("ready", me.abilityCooldown === 0);
    this.el.classList.toggle("dead", !me.alive);
  }

  /** Release everything (pause, end of match). */
  reset(): void {
    this.roles.clear();
    const t = this.input.touch;
    t.forward = t.strafe = 0; t.fire = t.jump = t.reload = t.ability = false;
    this.stickBase.hidden = true;
    for (const b of this.el.querySelectorAll(".on")) b.classList.remove("on");
  }

  remove(): void { this.reset(); this.el.remove(); }
}
