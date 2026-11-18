// Mouse + keyboard with pointer lock -> the core's Action (one per tick). Also drives the free camera.
import { type Action, noop } from "../core/actions";

export class Input {
  readonly keys = new Set<string>();
  private mouseDown = false;
  private rightDown = false;
  private dx = 0; private dy = 0;
  /** touch controls write here (touch.ts); merged with keyboard and mouse */
  readonly touch = { forward: 0, strafe: 0, fire: false, jump: false, crouch: false, reload: false, ability: false, autoFire: false };
  sensitivity = 0.0022; // radians per pixel
  /** one-shot key presses (Tab, V, H, ...) handled by the game */
  onKey: (code: string, e: KeyboardEvent) => void = () => {};
  onKeyUp: (code: string) => void = () => {};
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (["Tab", "Space", "ControlLeft", "ControlRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code) && this.locked) e.preventDefault();
      if (e.code === "Tab") e.preventDefault();
      if (!e.repeat) this.onKey(e.code, e);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => { this.keys.delete(e.code); this.onKeyUp(e.code); });
    window.addEventListener("blur", () => { this.keys.clear(); this.mouseDown = false; this.rightDown = false; });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // ignore the occasional huge jump some browsers report when the lock starts
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    target.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rightDown = true;
    });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) this.mouseDown = false; if (e.button === 2) this.rightDown = false; });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** automated tests: behave as if the mouse were locked (headless browsers can't lock it) */
  forceLocked = false;
  get locked(): boolean { return this.forceLocked || document.pointerLockElement === this.target; }

  /** tests: add mouse movement in pixels, as if the mouse moved */
  addMouse(dx: number, dy: number): void { this.dx += dx; this.dy += dy; }

  lock(): void {
    if (this.locked) return;
    if (typeof this.target.requestPointerLock !== "function") return; // iPhone browsers have no pointer lock
    const r = this.target.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    // some browsers don't support unadjustedMovement: fall back to the plain lock
    r?.catch?.(() => this.target.requestPointerLock());
  }

  /** Release a real pointer lock. (Touch play only pretends to be locked, and iPhone browsers have no
   *  Pointer Lock API at all: calling the missing exitPointerLock threw and broke the way back to the menu.) */
  unlock(): void {
    if (document.pointerLockElement === this.target && typeof document.exitPointerLock === "function") document.exitPointerLock();
  }

  /** Mouse movement not yet turned into an action (the camera shows it right away). */
  pendingYaw(): number { return -this.dx * this.sensitivity; }
  pendingPitch(): number { return -this.dy * this.sensitivity; }

  private act = noop();
  /** The action for the next tick. Consumes the mouse movement so far. */
  action(): Action {
    const k = this.keys, a = this.act;
    const t = this.touch;
    a.forward = Math.max(-1, Math.min(1, (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + t.forward));
    a.strafe = Math.max(-1, Math.min(1, (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + t.strafe));
    a.jump = k.has("Space") || t.jump;
    a.crouch = k.has("KeyC") || k.has("ControlLeft") || k.has("ControlRight") || t.crouch;
    a.fire = this.mouseDown || t.fire || t.autoFire;
    a.reload = k.has("KeyR") || t.reload;
    a.ability = k.has("KeyE") || this.rightDown || t.ability;
    a.yaw = this.pendingYaw();
    a.pitch = this.pendingPitch();
    this.dx = 0; this.dy = 0;
    return a;
  }

  /** Raw mouse delta for the free camera (consumes it). */
  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0; this.dy = 0;
    return r;
  }

  clear(): void { this.keys.clear(); this.mouseDown = false; this.rightDown = false; this.dx = 0; this.dy = 0; }
}
