// What a robot sees: the same information a player has, as numbers. No wall hacks.
//
// 1. Labelled rays from the eye, like a tiny depth image with a label per pixel: distance + what it hit
//    (wall, cover, floor, enemy head / torso / legs, teammate). FOVEATED: a wide sparse grid (the whole
//    view) plus a dense patch around the crosshair, so precise aim at range is possible. Occlusion and
//    partial cover come for free: a ray only reports what it reaches first.
// 2. Memory slots, one per other robot: what the minimap and outlines show a player (a robot you hit is
//    outlined for 2 s, a shooter pings the minimap for 1 s, a robot idle for 15 s is revealed, teammates
//    are always shown). Position + age + source.
// 3. Own state: health, ammo, reload, velocity, stance, the damage-direction indicator, the score.
//
// The heuristic bots read the structured Observation; the RL agent will read encodeObs() (a flat vector).

import * as C from "./config";
import { atan, atan2, cos, sin, wrap } from "./fmath";
import type { AbilityKind } from "./characters";
import { CHARACTERS } from "./characters";
import { SURF_SHIELD, type Game } from "./game";
import { HIT_NONE } from "./world";

// ---- ray layout. Offsets are in tangent space (like pixels on a screen plane), so tx = tan(yaw offset).
const PERI_COLS = 25, PERI_ROWS = 7, FOVEA_N = 9;
const PERI_TX = 1.19175359259421; // tan(50 deg): +-50 deg horizontally
const PERI_TY = 0.6248693519093275; // tan(32 deg)
const FOVEA_T = 0.05240777928304121; // tan(3 deg): the dense patch spans +-3 deg

export const VIEW_RANGE = 60;
export const N_RAYS = PERI_COLS * PERI_ROWS + FOVEA_N * FOVEA_N;

export const LABELS = ["none", "wall", "cover", "floor", "enemyHead", "enemyTorso", "enemyLegs", "teammate", "enemyShield"] as const;
export const L_NONE = 0, L_WALL = 1, L_COVER = 2, L_FLOOR = 3, L_HEAD = 4, L_TORSO = 5, L_LEGS = 6, L_MATE = 7, L_SHIELD = 8;
const PART_LABEL = { head: L_HEAD, torso: L_TORSO, legs: L_LEGS } as const;

/** Per-ray tangent offsets and the matching angles (radians). */
export const RAY_TX = new Float64Array(N_RAYS);
export const RAY_TY = new Float64Array(N_RAYS);
export const RAY_YAW = new Float64Array(N_RAYS); // positive = left of the crosshair (same sign as yaw)
export const RAY_PITCH = new Float64Array(N_RAYS); // positive = above
{
  let i = 0;
  // periphery: squared spacing, denser toward the middle
  for (let r = 0; r < PERI_ROWS; r++) {
    const v = (r / (PERI_ROWS - 1)) * 2 - 1;
    for (let c = 0; c < PERI_COLS; c++) {
      const u = (c / (PERI_COLS - 1)) * 2 - 1;
      RAY_TX[i] = u * Math.abs(u) * PERI_TX;
      RAY_TY[i] = -v * Math.abs(v) * PERI_TY;
      i++;
    }
  }
  // fovea: even spacing
  for (let r = 0; r < FOVEA_N; r++) {
    const v = (r / (FOVEA_N - 1)) * 2 - 1;
    for (let c = 0; c < FOVEA_N; c++) {
      const u = (c / (FOVEA_N - 1)) * 2 - 1;
      RAY_TX[i] = u * FOVEA_T;
      RAY_TY[i] = -v * FOVEA_T;
      i++;
    }
  }
  for (let k = 0; k < N_RAYS; k++) {
    RAY_YAW[k] = -atan(RAY_TX[k]); // a ray to the right needs a negative yaw turn
    RAY_PITCH[k] = atan(RAY_TY[k]);
  }
}

export const MEM_NONE = 0, MEM_OUTLINE = 1, MEM_PING = 2, MEM_REVEAL = 3, MEM_TEAMMATE = 4, MEM_SCAN = 5;

export class Observation {
  // rays
  readonly dist = new Float32Array(N_RAYS);
  readonly label = new Uint8Array(N_RAYS);
  /** which robot a ray hit (-1 = none). A player can tell robots apart by colour. */
  readonly agent = new Int8Array(N_RAYS);
  /** spawn-protected robots shimmer: a player can see it */
  readonly protectedVis = new Uint8Array(C.MAX_AGENTS);
  // memory slots, indexed by robot id (own slot unused)
  readonly memSource = new Uint8Array(C.MAX_AGENTS);
  readonly memX = new Float32Array(C.MAX_AGENTS);
  readonly memY = new Float32Array(C.MAX_AGENTS);
  readonly memZ = new Float32Array(C.MAX_AGENTS);
  readonly memAge = new Int32Array(C.MAX_AGENTS);
  readonly isMate = new Uint8Array(C.MAX_AGENTS);
  // self
  id = 0; team = 0; n = 0; tick = 0;
  alive = false;
  x = 0; y = 0; z = 0; yaw = 0; pitch = 0; vx = 0; vy = 0; vz = 0;
  eyeY = 0;
  health = 0; ammo = 0; reloadTicks = 0; fireCooldown = 0; protectTicks = 0;
  grounded = false; crouch = false;
  /** damage indicator: direction the last hit came from relative to where you look (radians, + = left), and its age */
  dmgYaw = 0; dmgAge = 9999;
  teamScore = 0; bestEnemyScore = 0; scoreLimit = 10;
  /** own character and its ability */
  character = 0; ability: AbilityKind = "dash"; abilityCooldown = 0; abilityTicks = 0;
}

/** Fill `o` with what robot `id` can perceive right now. Allocation-free. */
export function observe(g: Game, id: number, o: Observation): Observation {
  const a = g.agents[id];
  o.id = id; o.team = a.team; o.n = g.n; o.tick = g.tick; o.alive = a.alive;
  o.x = a.x; o.y = a.y; o.z = a.z; o.yaw = a.yaw; o.pitch = a.pitch; o.vx = a.vx; o.vy = a.vy; o.vz = a.vz;
  o.eyeY = g.eyeY(a);
  o.health = a.health; o.ammo = a.ammo; o.reloadTicks = a.reloadTicks; o.fireCooldown = a.fireCooldown; o.protectTicks = a.protectTicks;
  o.grounded = a.grounded; o.crouch = a.crouch;
  o.character = a.character; o.ability = a.ability; o.abilityCooldown = a.abilityCooldown; o.abilityTicks = a.abilityTicks;
  o.dmgAge = g.tick - a.lastDamageTick;
  o.dmgYaw = o.dmgAge < 600 ? wrap(atan2(-(a.dmgFromX - a.x), -(a.dmgFromZ - a.z)) - a.yaw) : 0;
  o.teamScore = g.teamScore[a.team];
  let best = 0;
  for (let t = 0; t < g.teamScore.length; t++) if (t !== a.team && g.teamScore[t] > best) best = g.teamScore[t];
  o.bestEnemyScore = best; o.scoreLimit = g.options.scoreLimit;

  o.protectedVis.fill(0);
  for (let j = 0; j < C.MAX_AGENTS; j++) { o.memSource[j] = MEM_NONE; o.isMate[j] = 0; }
  for (const b of g.agents) {
    o.isMate[b.id] = b.team === a.team && b.id !== id ? 1 : 0;
    if (b.id === id || !b.alive) continue;
    let src = MEM_NONE, age = 0, x = b.x, z = b.z;
    if (b.team === a.team) src = MEM_TEAMMATE;
    else if (b.outlineFor[id] > 0) src = MEM_OUTLINE;
    else if (b.scanFor[a.team] > 0) src = MEM_SCAN;
    else if (b.revealTicks > 0) src = MEM_REVEAL;
    else if (b.pingTicks > 0) { src = MEM_PING; age = C.PING_TICKS - b.pingTicks; x = b.pingX; z = b.pingZ; }
    o.memSource[b.id] = src;
    o.memX[b.id] = x; o.memZ[b.id] = z; o.memY[b.id] = src === MEM_PING ? 0 : b.y; o.memAge[b.id] = age;
  }

  if (!a.alive) {
    o.dist.fill(VIEW_RANGE); o.label.fill(L_NONE); o.agent.fill(-1);
    return o;
  }
  // camera basis: forward f, right r, up u
  const sy = sin(a.yaw), cy = cos(a.yaw), sp = sin(a.pitch), cp = cos(a.pitch);
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  const rx = cy, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  const ox = a.x, oy = o.eyeY, oz = a.z;
  for (let k = 0; k < N_RAYS; k++) {
    const tx = RAY_TX[k], ty = RAY_TY[k];
    let dx = fx + tx * rx + ty * ux, dy = fy + ty * uy, dz = fz + tx * rz + ty * uz;
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx *= inv; dy *= inv; dz *= inv;
    const hit = g.trace(id, ox, oy, oz, dx, dy, dz, VIEW_RANGE, true);
    o.dist[k] = hit.t;
    if (hit.agent >= 0) {
      o.agent[k] = hit.agent;
      o.label[k] = g.agents[hit.agent].team === a.team ? L_MATE : PART_LABEL[hit.part!];
      if (g.agents[hit.agent].protectTicks > 0) o.protectedVis[hit.agent] = 1;
    } else if (hit.surface === SURF_SHIELD) {
      o.agent[k] = hit.shield;
      o.label[k] = L_SHIELD;
    } else {
      o.agent[k] = -1;
      o.label[k] = hit.surface === HIT_NONE ? L_NONE : hit.surface; // 1 wall, 2 cover, 3 floor
    }
  }
  return o;
}

// ------------------------------------------------------------------------------------ flat vector
/** Floats per ray: distance, one-hot label (8), "that robot is spawn-protected". */
export const RAY_FEATURES = 1 + LABELS.length + 1;
export const MEM_FEATURES = ["known", "dxLocal", "dzLocal", "dy", "age", "outline", "ping", "reveal", "teammate", "scan"] as const;
export const SELF_FEATURES = [
  "alive", "health", "ammo", "reloading", "fireCooldown", "protected", "vxLocal", "vzLocal", "vy", "grounded", "crouch",
  "pitch", "dmgSin", "dmgCos", "dmgAge", "x", "z", "yawSin", "yawCos", "teamScore", "bestEnemyScore",
  "abilityReady", "abilityCooldown", "abilityActive", "charDash", "charShield", "charScan", "charCloak",
] as const;
export const MEM_SLOTS = C.MAX_AGENTS - 1;
export const OBS_SIZE = N_RAYS * RAY_FEATURES + MEM_SLOTS * MEM_FEATURES.length + SELF_FEATURES.length;

export const OBS_LAYOUT = {
  rays: {
    n: N_RAYS, features_per_ray: RAY_FEATURES, labels: LABELS, view_range_m: VIEW_RANGE,
    periphery: { cols: PERI_COLS, rows: PERI_ROWS, tan_x: PERI_TX, tan_y: PERI_TY, spacing: "u*|u| (denser in the middle)" },
    fovea: { cols: FOVEA_N, rows: FOVEA_N, tan: FOVEA_T, spacing: "even" },
    order: "periphery row-major (top row first), then fovea row-major; per ray: dist/range, onehot(label), protected",
  },
  memory: { slots: MEM_SLOTS, features: MEM_FEATURES, order: "other robots in id order, skipping self" },
  self: SELF_FEATURES,
};

/** The observation as one flat Float32Array (for the batch server / RL). */
export function encodeObs(o: Observation, out: Float32Array, off = 0): Float32Array {
  let i = off;
  const end = off + OBS_SIZE;
  for (let k = off; k < end; k++) out[k] = 0;
  for (let k = 0; k < N_RAYS; k++) {
    out[i] = o.dist[k] / VIEW_RANGE;
    out[i + 1 + o.label[k]] = 1;
    const ag = o.agent[k];
    out[i + 1 + LABELS.length] = ag >= 0 ? o.protectedVis[ag] : 0;
    i += RAY_FEATURES;
  }
  const sy = sin(o.yaw), cy = cos(o.yaw);
  for (let j = 0; j < C.MAX_AGENTS; j++) {
    if (j === o.id) continue;
    if (j < o.n && o.memSource[j] !== MEM_NONE) {
      const dx = o.memX[j] - o.x, dz = o.memZ[j] - o.z;
      // into the robot's own frame: forward = (-sy, -cy), right = (cy, -sy)
      out[i] = 1;
      out[i + 1] = (dx * cy - dz * sy) / 50; // right
      out[i + 2] = (-dx * sy - dz * cy) / 50; // forward
      out[i + 3] = (o.memY[j] - o.y) / 5;
      out[i + 4] = o.memAge[j] / C.PING_TICKS;
      out[i + 4 + o.memSource[j]] = 1;
    }
    i += MEM_FEATURES.length;
  }
  const hs = o.alive ? 1 : 0;
  const vr = o.vx * cy - o.vz * sy, vf = -o.vx * sy - o.vz * cy;
  const self = [
    hs, o.health / C.MAX_HEALTH, o.ammo / C.CLIP, o.reloadTicks / C.RELOAD_TICKS, o.fireCooldown / C.FIRE_TICKS, o.protectTicks > 0 ? 1 : 0,
    vr / C.RUN_SPEED, vf / C.RUN_SPEED, o.vy / C.JUMP_V, o.grounded ? 1 : 0, o.crouch ? 1 : 0,
    o.pitch / 1.45, o.dmgAge < 600 ? sin(o.dmgYaw) : 0, o.dmgAge < 600 ? cos(o.dmgYaw) : 0, Math.min(1, o.dmgAge / 120),
    o.x / 25, o.z / 25, sy, cy, o.teamScore / o.scoreLimit, o.bestEnemyScore / o.scoreLimit,
    o.abilityCooldown === 0 ? 1 : 0, o.abilityCooldown / CHARACTERS[o.character].cooldown, o.abilityTicks > 0 ? 1 : 0,
    o.ability === "dash" ? 1 : 0, o.ability === "shield" ? 1 : 0, o.ability === "scan" ? 1 : 0, o.ability === "cloak" ? 1 : 0,
  ];
  for (const v of self) out[i++] = v;
  return out;
}
