// What any player can do in one tick: the human (keyboard + mouse), a heuristic bot, or later the RL agent.
// One interface for all of them, so bots and the trained AI play by exactly the same rules.

export interface Action {
  /** -1 back, 0, 1 forward */
  forward: number;
  /** -1 left, 0, 1 right */
  strafe: number;
  jump: boolean;
  /** held: crouch while true */
  crouch: boolean;
  /** turn this tick, radians (positive = left). Clipped to the agent's turn cap. */
  yaw: number;
  /** look up (+) / down (-) this tick, radians. Clipped to the agent's turn cap. */
  pitch: number;
  /** held: the laser fires whenever it is ready */
  fire: boolean;
  reload: boolean;
  /** use the character's ability (when it is ready) */
  ability: boolean;
}

export const noop = (): Action => ({ forward: 0, strafe: 0, jump: false, crouch: false, yaw: 0, pitch: 0, fire: false, reload: false, ability: false });

export function copyAction(src: Action, dst: Action): Action {
  dst.forward = src.forward; dst.strafe = src.strafe; dst.jump = src.jump; dst.crouch = src.crouch;
  dst.yaw = src.yaw; dst.pitch = src.pitch; dst.fire = src.fire; dst.reload = src.reload; dst.ability = src.ability;
  return dst;
}

/** Aim deltas are stored at 1e-5 rad resolution so replays are compact and exact. */
export const quantize = (v: number) => Math.round(v * 1e5) / 1e5;

/** Packed form for replays: [forward, strafe, flags, yaw, pitch]; flags = jump | crouch<<1 | fire<<2 | reload<<3 | ability<<4. */
export type PackedAction = [number, number, number, number, number];

export function pack(a: Action): PackedAction {
  const flags = (a.jump ? 1 : 0) | (a.crouch ? 2 : 0) | (a.fire ? 4 : 0) | (a.reload ? 8 : 0) | (a.ability ? 16 : 0);
  return [a.forward, a.strafe, flags, quantize(a.yaw), quantize(a.pitch)];
}

export function unpack(p: PackedAction, out: Action = noop()): Action {
  out.forward = p[0]; out.strafe = p[1];
  out.jump = (p[2] & 1) !== 0; out.crouch = (p[2] & 2) !== 0; out.fire = (p[2] & 4) !== 0; out.reload = (p[2] & 8) !== 0; out.ability = (p[2] & 16) !== 0;
  out.yaw = p[3]; out.pitch = p[4];
  return out;
}

export function samePacked(a: PackedAction, b: PackedAction): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];
}

/**
 * The action as a flat vector (for the batch server / RL): 9 numbers in this order.
 * forward, strafe in {-1, 0, 1}; jump, crouch, fire, reload, ability > 0.5 = on; yaw, pitch in [-1, 1] x turn cap.
 */
export const ACTION_FIELDS = ["forward", "strafe", "jump", "crouch", "yaw", "pitch", "fire", "reload", "ability"] as const;
export const ACTION_SIZE = ACTION_FIELDS.length;

export function fromVector(v: ArrayLike<number>, o: number, turnCap: number, out: Action): Action {
  const tri = (x: number) => (x > 0.5 ? 1 : x < -0.5 ? -1 : 0);
  const unit = (x: number) => (x > 1 ? 1 : x < -1 ? -1 : x);
  out.forward = tri(v[o]); out.strafe = tri(v[o + 1]);
  out.jump = v[o + 2] > 0.5; out.crouch = v[o + 3] > 0.5;
  out.yaw = unit(v[o + 4]) * turnCap; out.pitch = unit(v[o + 5]) * turnCap;
  out.fire = v[o + 6] > 0.5; out.reload = v[o + 7] > 0.5; out.ability = v[o + 8] > 0.5;
  return out;
}
