// The robots. Gameplay hitboxes live in the core (config.ts HITBOX); the model is built around them so
// what you see is what you hit: head = the helmet, torso = the chest block, legs = the legs.
// Low-poly, a handful of shared materials, procedural animation (no skinning): cheap to draw.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CHARACTERS } from "../core/characters";
import { HITBOX } from "../core/config";

let HEX: THREE.CanvasTexture | null = null;
/** A honeycomb pattern for the energy shield. */
function hexTex(): THREE.CanvasTexture {
  if (HEX) return HEX;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 3;
  const r = 16, h = Math.sqrt(3) * r;
  for (let row = -1; row < 6; row++) for (let col = -1; col < 6; col++) {
    const cx = col * 1.5 * r * 1.0 + 8, cy = row * h + (col % 2 ? h / 2 : 0);
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    g.closePath(); g.stroke();
  }
  HEX = new THREE.CanvasTexture(c);
  HEX.wrapS = HEX.wrapT = THREE.RepeatWrapping;
  HEX.repeat.set(2, 3);
  return HEX;
}

/** Design stage 1: the hitboxes themselves, as coloured blocks. */
export function makePrimitiveRobot(color: string): THREE.Group {
  const g = new THREE.Group();
  const parts: [keyof typeof HITBOX, string][] = [["head", "#f2c14e"], ["torso", color], ["legs", "#5b6270"]];
  for (const [name, c] of parts) {
    const d = HITBOX[name];
    const m = new THREE.Mesh(new THREE.BoxGeometry(d.hw * 2, d.y1 - d.y0, d.hw * 2), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
    m.position.y = (d.y0 + d.y1) / 2;
    m.castShadow = true;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: "#1d2129" }));
    m.add(e);
    g.add(m);
  }
  return g;
}

// ---- shared geometry (built once, reused by every robot)
const GEO = {
  head: new RoundedBoxGeometry(0.32, 0.3, 0.32, 3, 0.07),
  visor: new RoundedBoxGeometry(0.27, 0.1, 0.06, 2, 0.03),
  ear: new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10).rotateZ(Math.PI / 2),
  antenna: new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5),
  bulb: new THREE.SphereGeometry(0.028, 10, 8),
  neck: new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8),
  chest: new RoundedBoxGeometry(0.5, 0.42, 0.34, 3, 0.07),
  belly: new RoundedBoxGeometry(0.36, 0.14, 0.26, 2, 0.04),
  vestPad: new RoundedBoxGeometry(0.2, 0.12, 0.04, 2, 0.02),
  sensor: new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12).rotateX(Math.PI / 2),
  pack: new RoundedBoxGeometry(0.34, 0.3, 0.12, 2, 0.03),
  packLight: new THREE.BoxGeometry(0.22, 0.03, 0.02),
  shoulder: new RoundedBoxGeometry(0.15, 0.13, 0.17, 2, 0.04),
  upperArm: new RoundedBoxGeometry(0.09, 0.24, 0.09, 2, 0.03),
  foreArm: new RoundedBoxGeometry(0.1, 0.22, 0.1, 2, 0.03),
  hand: new THREE.SphereGeometry(0.05, 8, 6),
  pelvis: new RoundedBoxGeometry(0.34, 0.12, 0.22, 2, 0.04),
  thigh: new RoundedBoxGeometry(0.13, 0.4, 0.14, 2, 0.04),
  knee: new THREE.SphereGeometry(0.065, 10, 8),
  shin: new RoundedBoxGeometry(0.12, 0.36, 0.14, 2, 0.04),
  shinPlate: new RoundedBoxGeometry(0.1, 0.2, 0.03, 2, 0.012),
  foot: new RoundedBoxGeometry(0.15, 0.07, 0.26, 2, 0.03),
  gunBody: new RoundedBoxGeometry(0.08, 0.1, 0.36, 2, 0.025),
  gunBarrel: new THREE.CylinderGeometry(0.022, 0.026, 0.2, 10).rotateX(Math.PI / 2),
  gunTip: new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10).rotateX(Math.PI / 2),
  gunGrip: new RoundedBoxGeometry(0.06, 0.12, 0.06, 2, 0.02),
  bubble: new THREE.IcosahedronGeometry(1.15, 2),
};

export interface RobotMaterials { body: THREE.MeshStandardMaterial; color: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; glow: THREE.MeshStandardMaterial }

export function robotMaterials(color: string): RobotMaterials {
  const c = new THREE.Color(color);
  return {
    body: new THREE.MeshStandardMaterial({ color: "#e8ecf1", roughness: 0.45, metalness: 0.1 }),
    color: new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: "#2a2f38", roughness: 0.6, metalness: 0.4 }),
    glow: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.3 }),
  };
}

export interface RobotPose {
  t: number; // seconds (any clock)
  speed: number; // horizontal m/s
  crouch: number; // 0 standing .. 1 crouched (smoothed)
  pitch: number; // aim pitch (radians)
  airborne: boolean;
  /** seconds since the last shot (Infinity = none) */
  shotAge: number;
  /** seconds since last hurt */
  hitAge: number;
  /** seconds since eliminated (negative/NaN = alive) */
  deadAge: number;
  protected: boolean;
  /** ability effects */
  shield: boolean;
  /** 1 = fully visible, ~0 = cloaked */
  visibility: number;
  /** velocity in the robot's own frame (m/s): forward (+ = where it faces) and side (+ = to its right) */
  fwd: number;
  side: number;
  /** seconds in the air (0 on the ground) */
  airAge: number;
  /** seconds since the last respawn (Infinity = none seen) */
  spawnAge: number;
  /** seconds since the Special Move was used (Infinity = none) */
  specialAge: number;
}

export const restPose = (): RobotPose => ({ t: 0, speed: 0, crouch: 0, pitch: 0, airborne: false, shotAge: Infinity, hitAge: Infinity, deadAge: NaN, protected: false, shield: false, visibility: 1, fwd: 0, side: 0, airAge: 0, spawnAge: Infinity, specialAge: Infinity });

/** What the game view needs from a robot: the stand-in RobotModel or a rigged character (character.ts). */
export interface RobotView {
  readonly root: THREE.Group;
  /** every drawn mesh (x-ray copies, first-person hiding) */
  readonly meshes: THREE.Mesh[];
  /** the blaster tip */
  readonly muzzle: THREE.Object3D;
  pose(p: RobotPose): void;
}

/** The third-person blaster (both model types): body, grip, barrel, glowing tip and the muzzle point. */
export function makeBlaster(m: RobotMaterials, shadows: boolean, meshes: THREE.Mesh[]): { gun: THREE.Group; muzzle: THREE.Object3D } {
  const gun = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    gun.add(mesh);
    meshes.push(mesh);
  };
  add(GEO.gunBody, m.dark, 0, 0.03, -0.1);
  add(GEO.gunGrip, m.dark, 0, -0.05, -0.02);
  add(GEO.gunBarrel, m.body, 0, 0.04, -0.37);
  add(GEO.gunTip, m.glow, 0, 0.04, -0.47);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.5);
  gun.add(muzzle);
  return { gun, muzzle };
}

/** Bulwark's energy shield: a curved panel the size of the core's shield (1.5 m x 1.96 m, 0.55 m in front). */
export function makeShieldMesh(color: THREE.Color): THREE.Mesh {
  const sg = new THREE.CylinderGeometry(1.6, 1.6, 1.96, 16, 1, true, -0.47, 0.94);
  sg.translate(0, 0.98, -1.6);
  sg.rotateY(Math.PI);
  sg.translate(0, 0, -0.55);
  const mesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: hexTex(), color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  mesh.visible = false;
  return mesh;
}

/** The spawn protection bubble. */
export function makeBubble(color: THREE.Color): THREE.Mesh {
  const b = new THREE.Mesh(GEO.bubble, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
  b.position.y = 0.9;
  b.visible = false;
  return b;
}

/** A modelled, animatable robot. `root` goes in the scene; position/yaw are set by the caller. */
export class RobotModel implements RobotView {
  readonly root = new THREE.Group();
  readonly mats: RobotMaterials;
  readonly meshes: THREE.Mesh[] = [];
  /** the muzzle (world position for laser beams) */
  readonly muzzle: THREE.Object3D;
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private headPivot = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; side: number }[] = [];
  private arms: { shoulder: THREE.Group; elbow: THREE.Group; side: number }[] = [];
  private bubble: THREE.Mesh;
  private walkPhase = 0;
  private lastT = 0;
  private baseGlow: THREE.Color;

  private shieldMesh: THREE.Mesh;
  private allMats: THREE.Material[];
  private lastVis = 1;

  /** `character` adds that character's accessory in its accent colour (stand-in until the final art). */
  constructor(color: string, shadows = true, character = -1) {
    const m = (this.mats = robotMaterials(color));
    this.baseGlow = m.glow.emissive.clone();
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadows;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    // the model faces -z (like the camera at yaw 0)
    this.root.add(this.hips);
    this.hips.position.y = 0.86;
    add(this.hips, GEO.pelvis, m.dark, 0, 0, 0);
    // legs
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.105, -0.03, 0);
      this.hips.add(hip);
      add(hip, GEO.thigh, m.body, 0, -0.2, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.41;
      hip.add(knee);
      add(knee, GEO.knee, m.dark);
      add(knee, GEO.shin, m.color, 0, -0.19, 0);
      add(knee, GEO.shinPlate, m.body, 0, -0.15, -0.08);
      add(knee, GEO.foot, m.dark, 0, -0.38, -0.04);
      this.legs.push({ hip, knee, side });
    }
    // torso
    this.spine.position.y = 0.06;
    this.hips.add(this.spine);
    add(this.spine, GEO.belly, m.dark, 0, 0.06, 0);
    add(this.spine, GEO.chest, m.body, 0, 0.3, 0);
    // laser-tag vest: coloured pads with glowing sensors on chest and back
    add(this.spine, GEO.vestPad, m.color, -0.11, 0.36, -0.17);
    add(this.spine, GEO.vestPad, m.color, 0.11, 0.36, -0.17);
    add(this.spine, GEO.sensor, m.glow, 0, 0.26, -0.18);
    add(this.spine, GEO.pack, m.color, 0, 0.3, 0.2);
    add(this.spine, GEO.packLight, m.glow, 0, 0.36, 0.265);
    add(this.spine, GEO.packLight, m.glow, 0, 0.3, 0.265);
    // head
    this.headPivot.position.y = 0.52;
    this.spine.add(this.headPivot);
    add(this.headPivot, GEO.neck, m.dark, 0, 0.02, 0);
    add(this.headPivot, GEO.head, m.body, 0, 0.19, 0);
    add(this.headPivot, GEO.visor, m.glow, 0, 0.2, -0.15);
    add(this.headPivot, GEO.ear, m.color, -0.17, 0.19, 0);
    add(this.headPivot, GEO.ear, m.color, 0.17, 0.19, 0);
    add(this.headPivot, GEO.antenna, m.dark, 0.09, 0.4, 0.06);
    add(this.headPivot, GEO.bulb, m.glow, 0.09, 0.48, 0.06);
    // arms: both hold the blaster forward
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.31, 0.42, 0);
      shoulder.rotation.order = "YXZ";
      this.spine.add(shoulder);
      add(shoulder, GEO.shoulder, m.color, side * 0.02, 0.02, 0);
      add(shoulder, GEO.upperArm, m.body, 0, -0.13, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.25;
      shoulder.add(elbow);
      add(elbow, GEO.foreArm, m.dark, 0, -0.1, 0);
      add(elbow, GEO.hand, m.dark, 0, -0.22, 0);
      this.arms.push({ shoulder, elbow, side });
    }
    // blaster, held in the right hand
    const gun = new THREE.Group();
    gun.position.set(0, -0.22, 0);
    this.arms[1].elbow.add(gun);
    const blaster = makeBlaster(m, shadows, this.meshes);
    gun.add(blaster.gun);
    this.muzzle = blaster.muzzle;
    this.gun = blaster.gun;
    // character accessory (a stand-in look per character)
    if (character >= 0) {
      const acc = new THREE.MeshStandardMaterial({ color: CHARACTERS[character].accent, roughness: 0.35, metalness: 0.2, emissive: CHARACTERS[character].accent, emissiveIntensity: 0.25 });
      if (character === 0) {
        // Dash: swept fins on the helmet and heel thrusters
        for (const sd of [-1, 1]) {
          const fin = add(this.headPivot, new THREE.ConeGeometry(0.05, 0.22, 4).rotateX(-Math.PI / 2 - 0.5), acc, sd * 0.17, 0.3, 0.06);
          fin.rotation.z = sd * 0.3;
        }
        for (const leg of this.legs) add(leg.knee, new THREE.CylinderGeometry(0.035, 0.05, 0.08, 8).rotateX(Math.PI / 2), acc, 0, -0.37, 0.11);
      } else if (character === 1) {
        // Bulwark: heavy shoulder plates and a chin guard
        for (const arm of this.arms) add(arm.shoulder, new RoundedBoxGeometry(0.2, 0.08, 0.24, 2, 0.03), acc, arm.side * 0.03, 0.1, 0);
        add(this.headPivot, new RoundedBoxGeometry(0.3, 0.06, 0.1, 2, 0.02), acc, 0, 0.07, -0.13);
      } else if (character === 2) {
        // Echo: a small radar dish on the back of the helmet
        const dish = add(this.headPivot, new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, 1.0), acc, 0, 0.36, 0.12);
        dish.rotation.x = -0.9;
        (dish.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      } else {
        // Wisp: a hood-like crest and trailing ribbons on the back
        add(this.headPivot, new RoundedBoxGeometry(0.34, 0.09, 0.36, 2, 0.04), acc, 0, 0.33, 0.01);
        for (const sd of [-1, 1]) add(this.spine, new RoundedBoxGeometry(0.05, 0.36, 0.02, 1, 0.01), acc, sd * 0.1, 0.05, 0.27);
      }
    }
    // energy shield (Bulwark): a curved panel in front, faces where the robot looks
    // same size as the core's shield (1.5 m x 1.96 m, 0.55 m in front), curved toward the robot
    this.shieldMesh = makeShieldMesh(m.glow.color);
    this.root.add(this.shieldMesh);
    // spawn protection bubble
    this.bubble = makeBubble(m.glow.color);
    this.root.add(this.bubble);
    this.allMats = [...new Set(this.meshes.map((x) => x.material as THREE.Material))];
    this.pose(restPose());
  }
  private gun: THREE.Group;

  /** Animate to a pose. Call every frame. */
  pose(p: RobotPose): void {
    const dt = Math.min(0.1, Math.max(0, p.t - this.lastT));
    this.lastT = p.t;
    const dead = p.deadAge >= 0;
    // ---- legs: walk cycle driven by distance, blend with crouch
    const run = Math.min(1, p.speed / 6);
    this.walkPhase += dt * (4 + 7 * run) * (p.speed > 0.2 ? 1 : 0);
    const c = p.crouch;
    const crouchA = 0.95 * c; // thigh forward angle when crouched
    for (const leg of this.legs) {
      const ph = this.walkPhase + (leg.side > 0 ? Math.PI : 0);
      const swing = Math.sin(ph) * 0.65 * run * (1 - 0.5 * c);
      const lift = Math.max(0, -Math.cos(ph)) * 0.9 * run;
      leg.hip.rotation.x = swing + crouchA + (p.airborne ? 0.5 : 0) * (leg.side > 0 ? 1 : 0.4);
      leg.knee.rotation.x = -(lift + crouchA * 2 + (p.airborne ? 0.7 : 0));
    }
    // hips go down when crouched (core: 1.8 m -> 1.25 m tall), bob while running
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.04 * run;
    const breathe = Math.sin(p.t * 2.2) * 0.008;
    this.hips.position.y = 0.86 - 0.3 * c + bob;
    this.spine.position.y = 0.06 + breathe;
    this.spine.rotation.x = -0.12 * run - 0.18 * c; // lean into the run / hunch when crouched
    // ---- aim: head and arms follow the pitch; recoil after a shot
    const recoil = p.shotAge < 0.12 ? (1 - p.shotAge / 0.12) : 0;
    this.headPivot.rotation.x = p.pitch * 0.6;
    this.headPivot.rotation.y = Math.sin(p.t * 0.7) * 0.06 * (1 - run);
    for (const arm of this.arms) {
      const aimX = Math.PI / 2 + p.pitch - this.spine.rotation.x;
      arm.shoulder.rotation.x = aimX - 0.95 + recoil * 0.15;
      arm.shoulder.rotation.z = 0;
      arm.shoulder.rotation.y = arm.side > 0 ? 0.1 : -0.55; // left hand reaches across to the blaster
      arm.elbow.rotation.x = 0.95 - recoil * 0.1;
    }
    this.gun.rotation.x = -Math.PI / 2 + 0.0;
    this.gun.position.z = recoil * 0.05;
    // ---- hit flash
    const flash = p.hitAge < 0.12 ? 1 - p.hitAge / 0.12 : 0;
    this.mats.body.emissive.setRGB(flash, flash * 0.85, flash * 0.7);
    this.mats.glow.emissive.copy(this.baseGlow).multiplyScalar(1 + flash * 2 + recoil * 0.8);
    if (flash > 0) this.spine.rotation.x += flash * 0.25; // flinch
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
    // ---- protection bubble
    this.bubble.visible = p.protected && !dead;
    if (this.bubble.visible) {
      (this.bubble.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(p.t * 9);
      this.bubble.rotation.y = p.t * 0.6;
    }
    // ---- eliminated: knocked back, head pops, then the robot powers down and shrinks away
    if (dead) {
      const a = p.deadAge;
      const fall = Math.min(1, a / 0.45);
      this.hips.rotation.x = fall * 1.35;
      this.hips.position.y = 0.86 - fall * 0.6;
      this.headPivot.position.y = 0.52 + Math.min(a, 0.6) * 1.6 - 4.5 * Math.min(a, 0.6) ** 2;
      this.headPivot.rotation.z = a * 6;
      const off = a > 0.35 ? Math.max(0, 1 - (a - 0.35) * 2) : 1;
      this.mats.glow.emissive.copy(this.baseGlow).multiplyScalar(off * (1 + (a < 0.1 ? 3 : 0)));
      const s = a > 1.4 ? Math.max(0.001, 1 - (a - 1.4) / 0.5) : 1;
      this.root.scale.setScalar(s);
    } else {
      this.hips.rotation.x = 0;
      this.headPivot.position.y = 0.52;
      this.headPivot.rotation.z = 0;
      this.root.scale.setScalar(1);
    }
  }
}
