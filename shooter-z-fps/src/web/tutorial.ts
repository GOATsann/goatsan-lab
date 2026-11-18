// Tutorial: a guided practice run on the army base. Robot 1 starts as a still practice target (its bot
// is paused and it is placed in front of you), and at the end wakes up as a slow "training" bot that
// shoots back. Each step completes when you do it; N skips a step.
import { CHARACTERS } from "../core/characters";
import type { GameEvent } from "../core/game";
import type { Match } from "../core/match";

export interface Step {
  title: string;
  hint: string;
  /** called every tick with this tick's events; return true when the step is done */
  check(t: TutorialState, events: readonly GameEvent[]): boolean;
  /** set up the practice target for this step */
  target?: "still" | "fighter" | "none";
}

export interface TutorialState {
  match: Match;
  /** progress counters for the current step */
  yawTurned: number;
  walked: number;
  jumped: boolean;
  crouched: boolean;
}

/** Where things stand in the tutorial: you on the south side, the target 8 m ahead in the open. */
export const TUTORIAL_MAP = "base" as const;
const ME = { x: 0, z: 18.5, yaw: 0 };
const TARGET = { x: 0, z: 10.5, yaw: Math.PI };
const FIGHTER = { x: 4, z: -2, yaw: Math.PI };

export function tutorialSteps(character: number, touch = false, simple = false): Step[] {
  const ch = CHARACTERS[character];
  const T = (keys: string, tap: string, auto = tap) => (touch ? (simple ? auto : tap) : keys);
  const hitBy = (events: readonly GameEvent[], part?: string) => events.some((e) => e.type === "hit" && e.a === 0 && e.v === 1 && !e.blocked && (!part || e.part === part));
  return [
    { title: "Look around", hint: T("Move the mouse to look left and right.", "Drag on the right side of the screen to look around."), target: "none", check: (t) => t.yawTurned > 2.2 },
    { title: "Move", hint: T("Walk with W A S D.", "Put your left thumb down and slide it: that's your stick."), target: "none", check: (t) => t.walked > 5 },
    { title: "Jump and crouch", hint: T("Jump with Space. Crouch by holding C: smaller, steadier, slower.", "Tap Jump, then tap Crouch (tap it again to stand up)."), target: "none", check: (t) => t.jumped && t.crouched },
    { title: "Shoot the target", hint: T("Aim at the robot ahead and left-click to fire.", "Aim at the robot ahead and hold Fire (drag while holding it to aim).", "Put the crosshair on the robot ahead: Simple firing shoots for you."), target: "still", check: (_t, ev) => hitBy(ev) },
    { title: "Headshot", hint: T("Hit the head: 2.5x damage, and a gold marker.", "Put the crosshair on the head and tap Fire: 2.5x damage, and a gold marker.", "Put the crosshair on its head: 2.5x damage, and a gold marker."), target: "still", check: (_t, ev) => hitBy(ev, "head") },
    { title: "Reload", hint: T("Press R to reload (24 shots per clip).", "Tap R to reload (24 shots per clip)."), target: "still", check: (_t, ev) => ev.some((e) => e.type === "reload" && e.a === 0) },
    { title: `Special Move: ${ch.abilityName}`, hint: T(`Press E or right-click. ${ch.blurb}`, `Tap the ${ch.abilityName} button. ${ch.blurb}`), target: "still", check: (_t, ev) => ev.some((e) => e.type === "ability" && e.a === 0) },
    { title: "Eliminate the target", hint: "Take the training target down (100 health).", target: "still", check: (_t, ev) => ev.some((e) => e.type === "kill" && e.a === 0) },
    { title: "Now it shoots back", hint: "The training target fights back now, slowly. Eliminate it. Use cover!", target: "fighter", check: (_t, ev) => ev.some((e) => e.type === "kill" && e.a === 0 && e.v === 1) },
  ];
}

export class Tutorial {
  readonly steps: Step[];
  index = 0;
  done = false;
  /** seconds the "step complete" flash stays up */
  private flash = 0;
  readonly state: TutorialState;
  private lastYaw = 0;
  private lastX = 0; private lastZ = 0;
  readonly el: HTMLElement;

  private touch: boolean;

  constructor(match: Match, character: number, parent: HTMLElement, touch = false, simple = false) {
    this.touch = touch;
    this.steps = tutorialSteps(character, touch, simple);
    this.state = { match, yawTurned: 0, walked: 0, jumped: false, crouched: false };
    this.el = document.createElement("div");
    this.el.className = touch ? "tut touch-tut" : "tut";
    parent.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".tut-skip")) this.next();
    });
    const g = match.game;
    g.teleport(0, ME.x, ME.z, ME.yaw);
    this.lastYaw = g.agents[0].yaw;
    this.lastX = g.agents[0].x; this.lastZ = g.agents[0].z;
    this.enterStep();
  }

  private enterStep(): void {
    const s = this.state;
    s.yawTurned = 0; s.walked = 0; s.jumped = false; s.crouched = false;
    const step = this.steps[this.index];
    const m = s.match;
    if (!step) return;
    // the practice robot: paused and parked in front of you, or awake as the training fighter
    m.paused[1] = step.target !== "fighter";
    if (step.target === "still") m.game.teleport(1, TARGET.x, TARGET.z, TARGET.yaw);
    else if (step.target === "fighter") m.game.teleport(1, FIGHTER.x, FIGHTER.z, FIGHTER.yaw);
    else m.game.teleport(1, -20, -21, 0); // out of the way in a far corner
    this.render();
  }

  /** Call after every tick. */
  update(events: readonly GameEvent[], dt: number): void {
    if (this.done) return;
    const s = this.state, g = s.match.game, me = g.agents[0];
    let dy = me.yaw - this.lastYaw;
    if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
    s.yawTurned += Math.abs(dy);
    this.lastYaw = me.yaw;
    s.walked += Math.hypot(me.x - this.lastX, me.z - this.lastZ);
    this.lastX = me.x; this.lastZ = me.z;
    if (events.some((e) => e.type === "jump" && e.a === 0)) s.jumped = true;
    if (me.crouch) s.crouched = true;
    // keep the still target where it belongs (it respawns elsewhere after an elimination)
    const step = this.steps[this.index];
    for (const e of events) {
      if (e.type === "spawn" && e.a === 1 && step.target === "still") g.teleport(1, TARGET.x, TARGET.z, TARGET.yaw);
      if (e.type === "spawn" && e.a === 1 && step.target === "fighter") g.teleport(1, FIGHTER.x, FIGHTER.z, FIGHTER.yaw);
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (step.check(s, events)) this.next();
  }

  next(): void {
    this.flash = 1.2;
    this.index++;
    if (this.index >= this.steps.length) {
      this.done = true;
      this.state.match.paused[1] = true;
      this.render();
      return;
    }
    this.enterStep();
  }

  render(): void {
    if (this.done) {
      this.el.innerHTML = `<div class="tut-card done"><b>Tutorial complete</b><p>You're ready. Can you beat AI?</p>${this.touch ? "" : `<p class="keys">Press <kbd>Enter</kbd> to play a real match, <kbd>Esc</kbd> for the menu</p>`}</div>`;
      return;
    }
    const step = this.steps[this.index];
    const dots = this.steps.map((_, i) => `<i class="${i < this.index ? "ok" : i === this.index ? "now" : ""}"></i>`).join("");
    this.el.innerHTML = `<div class="tut-card"><div class="dots">${dots}</div><small>Step ${this.index + 1} of ${this.steps.length}</small><b>${step.title}</b><p>${step.hint}</p>${this.touch ? `<button class="tut-skip">Skip step</button>` : `<p class="keys"><kbd>N</kbd> skip step · <kbd>Esc</kbd> pause</p>`}</div>`;
  }
}
