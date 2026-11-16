// Keyboard and swipe input -> game actions. Inputs queue and apply on the next tick.
import { JUMP, LEFT, RIGHT, ROLL, type Action } from "../core/game";

export class Input {
  private queue: Action[] = [];
  onStart: () => void = () => {};

  constructor(target: HTMLElement | Window = window) {
    window.addEventListener("keydown", (e) => {
      const a = KEYS[e.key];
      if (a !== undefined) {
        e.preventDefault();
        this.queue.push(a);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        this.onStart();
      }
    });
    let sx = 0, sy = 0, st = 0;
    target.addEventListener("pointerdown", (e) => {
      const p = e as PointerEvent;
      sx = p.clientX; sy = p.clientY; st = performance.now();
    });
    target.addEventListener("pointerup", (e) => {
      const p = e as PointerEvent;
      const dx = p.clientX - sx, dy = p.clientY - sy;
      if (Math.hypot(dx, dy) < 24 || performance.now() - st > 600) return this.onStart();
      if (Math.abs(dx) > Math.abs(dy)) this.queue.push(dx < 0 ? LEFT : RIGHT);
      else this.queue.push(dy < 0 ? JUMP : ROLL);
    });
  }

  /** The next queued action, one per tick. */
  next(): Action {
    return (this.queue.shift() ?? 0) as Action;
  }

  clear(): void {
    this.queue.length = 0;
  }
}

const KEYS: Record<string, Action> = {
  ArrowLeft: LEFT, a: LEFT, A: LEFT,
  ArrowRight: RIGHT, d: RIGHT, D: RIGHT,
  ArrowUp: JUMP, w: JUMP, W: JUMP,
  ArrowDown: ROLL, s: ROLL, S: ROLL,
};
