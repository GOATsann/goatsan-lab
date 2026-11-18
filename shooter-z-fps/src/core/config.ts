// Every gameplay number in one place. Units: metres, seconds (as ticks), radians.
// The core runs at a fixed 60 ticks per second. Changing a rule here = bump VERSION in game.ts.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
/** Bots (and later the RL agent) decide every DECISION_TICKS ticks; the human acts every tick. */
export const DECISION_TICKS = 3;

// ---- bodies
export const RADIUS = 0.32; // collision half-width (square footprint)
export const STAND_H = 1.8;
export const CROUCH_H = 1.25;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.1;
export const STEP_UP = 0.36; // walk up steps this high without jumping

/** Hitboxes, relative to the feet, standing. Crouching scales the heights by CROUCH_H / STAND_H. */
export const HITBOX = {
  legs: { y0: 0, y1: 0.85, hw: 0.24 },
  torso: { y0: 0.85, y1: 1.42, hw: 0.3 },
  head: { y0: 1.42, y1: 1.78, hw: 0.17 },
} as const;
export const PARTS = ["head", "torso", "legs"] as const;
export type Part = (typeof PARTS)[number];
export const PART_MULT: Record<Part, number> = { head: 2.5, torso: 1, legs: 0.75 };

// ---- movement
export const RUN_SPEED = 6.0;
export const CROUCH_SPEED = 2.8;
export const GROUND_ACCEL = 60; // m/s^2 toward the wished velocity
export const AIR_ACCEL = 12;
export const GRAVITY = 20;
export const JUMP_V = 6.6; // ~1.1 m jump
/** Moving less than this per tick counts as standing still for the idle reveal. */
export const IDLE_MOVE_EPS = 0.01;

// ---- weapon (hitscan laser)
export const MAX_HEALTH = 100;
export const BASE_DAMAGE = 20; // torso 20, head 50, legs 15
export const FIRE_TICKS = 8; // 7.5 shots per second
export const CLIP = 24;
export const RELOAD_TICKS = 90; // 1.5 s
export const RANGE = 80;
export const SPREAD_BASE = 0.002; // radians, standing still
export const SPREAD_MOVE = 0.012; // extra at full run speed
export const SPREAD_AIR = 0.03;
export const SPREAD_CROUCH_MULT = 0.6;

// ---- health regen (makes cover worth taking)
export const REGEN_DELAY_TICKS = 5 * TICK_HZ;
export const REGEN_PER_TICK = 15 / TICK_HZ;

// ---- respawn
export const RESPAWN_TICKS = Math.round(2.5 * TICK_HZ);
export const PROTECT_TICKS = 2 * TICK_HZ; // spawn protection; firing ends it

// ---- reveal rules (same for players and bots)
export const OUTLINE_TICKS = 2 * TICK_HZ; // an enemy you hit stays outlined for you, even behind cover
export const PING_TICKS = 1 * TICK_HZ; // firing shows the shooter on everyone's minimap
export const IDLE_REVEAL_AFTER = 15 * TICK_HZ; // no move and no shot for this long ...
export const IDLE_REVEAL_TICKS = 2 * TICK_HZ; // ... reveals you to everyone for this long

// ---- match
export const DEFAULT_SCORE_LIMIT = 10;
export const MAX_AGENTS = 4;

// ---- human turn cap (effectively none); bots set their own, lower caps
export const HUMAN_TURN_CAP = Math.PI;

// ---- abilities (one per character; same health and weapon for everyone)
export const DASH_TICKS = 10; // a 1/6 s burst
export const DASH_SPEED = 17; // ~2.8 m
export const DASH_COOLDOWN = 6 * TICK_HZ;
export const SHIELD_TICKS = 2 * TICK_HZ;
export const SHIELD_COOLDOWN = 12 * TICK_HZ;
export const SHIELD_FORWARD = 0.55; // metres in front of the body
export const SHIELD_HALF_W = 0.75;
export const SHIELD_HALF_H = 0.98;
export const SCAN_RANGE = 20;
export const SCAN_REVEAL_TICKS = Math.round(1.5 * TICK_HZ);
export const SCAN_COOLDOWN = 15 * TICK_HZ;
export const SCAN_PULSE_TICKS = 24; // the visible pulse
export const CLOAK_TICKS = 3 * TICK_HZ;
export const CLOAK_COOLDOWN = 15 * TICK_HZ;
/** a cloaked robot can still be made out this close (rays and eyes) */
export const CLOAK_SEE_DIST = 6;
