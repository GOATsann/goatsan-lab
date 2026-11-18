// Rigged characters (Dash, Bulwark, Echo, Wisp): skinned GLB models with their own animation clips, used
// in place of the stand-in robots when public/characters/ has them (see ASSETS.md). Without them the game
// uses the stand-in robots from robot.ts. Models never change gameplay: hitboxes live in the core.
//
// GLB contract (made by the character build tools): metres, ~1.8 m tall, feet at the origin, facing -Z,
// one skin, and these clips on it:
//   lower body + torso + head: idle, run (0.7 s at 6 m/s), strafeLeft, strafeRight, jump, crouch, crouchWalk
//   arms only:                 shoot (two-handed aim with recoil; its last frame is the steady aim)
//   torso + head only:         hit
//   full body:                 eliminated (ends lying down), spawn, special (the Special Move)
// The emissive map is a grey-scale glow mask; the game tints it with the robot's slot colour.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { CHARACTERS } from "../core/characters";
import { makeBlaster, makeBubble, makeShieldMesh, RobotModel, robotMaterials, type RobotPose, type RobotView } from "./robot";

interface CharacterFile { id: string; character: number; file: string }
interface Template { scene: THREE.Group; clips: Map<string, THREE.AnimationClip>; specialHold: boolean }

const templates: (Template | null)[] = CHARACTERS.map(() => null);
let loading: Promise<void> | null = null;
let loaded = false;

/** Start loading the character models (once). Resolves when done; missing files leave the stand-ins. */
export function loadCharacterModels(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const base = ""; // relative to the page (index.html and capture.html sit at the site root)
    let list: CharacterFile[] = [];
    try {
      const r = await fetch(`${base}characters/characters.json`);
      if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) list = await r.json();
    } catch { /* no models: stand-ins */ }
    const loader = new GLTFLoader();
    await Promise.all(list.map(async (f) => {
      if (!(f.character >= 0 && f.character < CHARACTERS.length)) return;
      try {
        const gltf = await loader.loadAsync(`${base}characters/${f.file}`);
        const clips = new Map(gltf.animations.map((c) => [c.name, c]));
        if (!clips.has("idle") || !clips.has("shoot")) throw new Error("missing clips");
        templates[f.character] = { scene: gltf.scene, clips, specialHold: CHARACTERS[f.character].ability === "shield" };
      } catch (e) {
        console.warn(`Shooter Z: character ${f.id} not loaded, using the stand-in robot`, e);
      }
    }));
    loaded = true;
  })();
  return loading;
}
/** True once loading has finished (whatever it found). */
export const charactersLoaded = (): boolean => loaded;
export const hasCharacterModel = (character: number): boolean => !!templates[character];

/**
 * The robot for a character: the rigged model if it is loaded, else the stand-in.
 * `color` is the slot colour (glow, blaster, shield); null keeps the character's own glow colour.
 */
export function makeRobot(color: string, shadows: boolean, character: number, ownGlow = false): RobotView {
  const t = character >= 0 ? templates[character] : null;
  return t ? new CharacterModel(t, color, shadows, ownGlow) : new RobotModel(color, shadows, character);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

export class CharacterModel implements RobotView {
  readonly root = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  readonly muzzle: THREE.Object3D;
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private act = new Map<string, THREE.AnimationAction>();
  private skinMats: THREE.MeshStandardMaterial[] = [];
  private allMats: THREE.Material[] = [];
  private glow: THREE.Color;
  private chest: THREE.Bone; private head: THREE.Bone;
  private shieldMesh: THREE.Mesh; private bubble: THREE.Mesh;
  private gunMats;
  private baseGlow: THREE.Color;
  private specialDur: number;
  private specialHold: boolean;
  private lastT = 0; private lastVis = 1;
  private ph = { run: 0, strafe: 0, crouchWalk: 0, idle: 0, crouch: 0 };
  private air = 0;
  private specialOn = 0;

  constructor(t: Template, color: string, shadows: boolean, ownGlow: boolean) {
    this.model = SkeletonUtils.clone(t.scene);
    this.root.add(this.model);
    this.specialHold = t.specialHold;
    const slot = new THREE.Color(color);
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = shadows;
      m.frustumCulled = false; // skinned bounds move with the animation
      const mat = (m.material as THREE.MeshStandardMaterial).clone(); // per robot: tint, flash, cloak fade
      if (!ownGlow) mat.emissive.copy(slot);
      m.material = mat;
      this.skinMats.push(mat);
      this.meshes.push(m);
    });
    this.glow = this.skinMats[0]?.emissive.clone() ?? slot;
    this.baseGlow = this.glow.clone();
    const bone = (n: string) => this.model.getObjectByName(n) as THREE.Bone;
    this.chest = bone("Spine"); this.head = bone("Head");
    // clips: every action plays all the time; pose() sets the weights and times (time never runs on its own)
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of t.clips) {
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = true;
      a.play();
      a.paused = true;
      a.enabled = false;
      this.act.set(name, a);
    }
    this.specialDur = t.clips.get("special")?.duration ?? 0.5;
    // the blaster in the right hand, pointing forward when the arms are in the aim
    const gm = (this.gunMats = robotMaterials(color));
    const { gun, muzzle } = makeBlaster(gm, shadows, this.meshes);
    this.muzzle = muzzle;
    this.mountGun(gun, bone("RightHand"));
    this.shieldMesh = makeShieldMesh(gm.glow.color);
    this.bubble = makeBubble(gm.glow.color);
    this.root.add(this.shieldMesh, this.bubble);
    this.allMats = [...new Set(this.meshes.map((x) => x.material as THREE.Material))];
  }

  /** Put the blaster in the hand so that, in the aim pose, it points straight ahead (-Z) with its top up. */
  private mountGun(gun: THREE.Group, hand: THREE.Bone): void {
    this.weights({ idle: 1, shoot: 1 }, { idle: 0, shoot: 0.2 });
    this.root.updateMatrixWorld(true);
    const hm = hand.matrixWorld.clone();
    const hp = new THREE.Vector3(), hq = new THREE.Quaternion(), hs = new THREE.Vector3();
    hm.decompose(hp, hq, hs);
    // grip a little past the wrist, toward the fingers
    const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(hq).normalize();
    const want = hp.clone().addScaledVector(fingers, 0.06).add(new THREE.Vector3(0, 0.02, 0));
    hand.add(gun);
    gun.position.copy(hand.worldToLocal(want.clone()));
    gun.quaternion.copy(hq).invert(); // root-space identity: forward -Z, up +Y
    gun.scale.setScalar(1 / hs.x);
  }

  /** Set action weights (others off) and times. */
  private weights(w: Record<string, number>, times: Record<string, number>): void {
    for (const [name, a] of this.act) {
      const k = w[name] ?? 0;
      a.enabled = k > 0.001;
      if (a.enabled) { a.setEffectiveWeight(k); a.time = times[name] ?? 0; }
    }
    this.mixer.update(0);
  }

  pose(p: RobotPose): void {
    const dt = Math.min(0.1, Math.max(0, p.t - this.lastT));
    this.lastT = p.t;
    const dead = p.deadAge >= 0;
    const W: Record<string, number> = {}, T: Record<string, number> = {};
    // ---- full-body clips: eliminated > spawn > special
    let full = 0;
    if (dead) {
      full = clamp01(p.deadAge / 0.08);
      W.eliminated = full; T.eliminated = Math.min(p.deadAge, 0.999);
    } else if (p.spawnAge < 0.8) {
      full = clamp01((0.8 - p.spawnAge) / 0.15);
      W.spawn = full; T.spawn = p.spawnAge;
    } else if (this.act.has("special") && p.specialAge < (this.specialHold ? 30 : this.specialDur)) {
      // Bulwark holds the raised shield while it is up, then lowers it; the others play once
      const on = this.specialHold ? (p.shield || p.specialAge < this.specialDur ? 1 : 0) : 1;
      this.specialOn += (on - this.specialOn) * Math.min(1, dt * (on ? 30 : 8));
      full = this.specialHold ? this.specialOn : clamp01(p.specialAge / 0.05);
      W.special = full; T.special = Math.min(p.specialAge, this.specialDur - 0.001);
    }
    if (!(this.specialHold && !dead && p.spawnAge >= 0.8 && W.special)) this.specialOn = 0;
    const rest = 1 - full;
    // ---- locomotion (lower body): idle / run / strafe, crouched versions, jump
    const speed = p.speed, c = clamp01(p.crouch);
    const move = clamp01((speed - 0.3) / 2.2);
    const fwd = p.fwd, side = p.side;
    const sideW = speed > 0.3 ? clamp01(Math.abs(side) / (Math.abs(side) + Math.abs(fwd) + 1e-6) * 1.6 - 0.3) : 0;
    this.air += ((p.airborne ? 1 : 0) - this.air) * Math.min(1, dt * 14);
    const ground = rest * (1 - this.air);
    const dir = fwd < -0.3 && Math.abs(fwd) > Math.abs(side) ? -1 : 1; // running backwards: the cycle in reverse
    this.ph.run += dt * (speed / 6) * dir;
    this.ph.strafe += dt * Math.max(0.6, speed / 5);
    this.ph.crouchWalk += dt * Math.max(0.5, speed / 2.8);
    this.ph.idle += dt; this.ph.crouch += dt;
    const lw = (name: string, w: number, time: number) => { if (w > 0.001) { W[name] = (W[name] ?? 0) + w; T[name] = time; } };
    const wrap = (x: number, d: number) => ((x % d) + d) % d;
    lw("idle", ground * (1 - move) * (1 - c), wrap(this.ph.idle, 2.4));
    lw("run", ground * move * (1 - sideW) * (1 - c), wrap(this.ph.run * 0.7, 0.7));
    lw(side < 0 ? "strafeLeft" : "strafeRight", ground * move * sideW * (1 - c), wrap(this.ph.strafe, 0.6));
    lw("crouch", ground * (1 - move) * c, wrap(this.ph.crouch, 1.6));
    lw("crouchWalk", ground * move * c, wrap(this.ph.crouchWalk * dir, 0.8));
    lw("jump", rest * this.air, Math.min(p.airAge, 0.42));
    // ---- arms: always the two-handed aim, with recoil right after a shot
    lw("shoot", rest, Math.min(p.shotAge, 0.2));
    // ---- hit flinch (torso and head), on top
    if (!dead && p.hitAge < 0.35) lw("hit", rest * 1.2, p.hitAge);
    this.weights(W, T);
    // ---- aim pitch: bend the chest and head (the arms and blaster follow the chest)
    if (!dead && rest > 0) {
      const pitch = Math.max(-1.1, Math.min(1.1, p.pitch)) * rest;
      this.root.updateMatrixWorld(true);
      this.bend(this.chest, pitch * 0.75);
      this.bend(this.head, pitch * 0.25);
    }
    // ---- materials: hit flash, glow (brighter on a shot), power-down when eliminated
    const flash = p.hitAge < 0.12 ? 1 - p.hitAge / 0.12 : 0;
    const recoil = p.shotAge < 0.12 ? 1 - p.shotAge / 0.12 : 0;
    let glowK = 1 + flash * 1.5 + recoil * 0.6;
    if (dead) { const a = p.deadAge; glowK = (a > 0.35 ? Math.max(0, 1 - (a - 0.35) * 2) : 1) * (1 + (a < 0.1 ? 3 : 0)); }
    for (const m of this.skinMats) {
      m.color.setScalar(1 + flash * 1.6);
      m.emissive.copy(this.baseGlow).multiplyScalar(glowK);
    }
    this.gunMats.glow.emissive.copy(this.gunMats.glow.color).multiplyScalar(dead ? glowK : 1 + recoil * 0.8);
    // ---- shield and cloak
    this.shieldMesh.visible = p.shield && !dead;
    if (this.shieldMesh.visible) (this.shieldMesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.15 * Math.sin(p.t * 14);
    if (p.visibility !== this.lastVis) {
      this.lastVis = p.visibility;
      for (const mt of this.allMats) {
        mt.transparent = p.visibility < 1;
        mt.opacity = p.visibility;
        mt.depthWrite = p.visibility >= 1;
        mt.needsUpdate = true;
      }
      for (const mesh of this.meshes) mesh.castShadow = p.visibility >= 1;
    }
    this.bubble.visible = p.protected && !dead;
    if (this.bubble.visible) {
      (this.bubble.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(p.t * 9);
      this.bubble.rotation.y = p.t * 0.6;
    }
    // ---- eliminated: lies down, powers down, then shrinks away before the respawn (like the stand-in)
    const s = dead && p.deadAge > 1.4 ? Math.max(0.001, 1 - (p.deadAge - 1.4) / 0.5) : 1;
    this.root.scale.setScalar(s);
  }

  /** Rotate a bone about the robot's own right axis (+ = look up), after the clips are applied. */
  private bend(b: THREE.Object3D, angle: number): void {
    if (!b?.parent || Math.abs(angle) < 1e-4) return;
    this.root.getWorldQuaternion(_q);
    _v.set(1, 0, 0).applyQuaternion(_q); // the robot's right, in world space
    b.parent.getWorldQuaternion(_q2);
    _v.applyQuaternion(_q2.invert());
    b.quaternion.premultiply(_q.setFromAxisAngle(_v, angle));
    b.updateMatrixWorld(true);
  }
}
