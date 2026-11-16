// Characters: a placeholder courier made of simple shapes now, the real rigged GLB models later.
// Drop-in: put <id>.glb and characters.json in public/characters/ (spec in PLAN.md section 10).
// The view only reads the game state; hitboxes stay in the core, so models never change gameplay.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as C from "../core/config";
import type { Game } from "../core/game";

/** Air time of a normal jump, from the core's physics (gravity halves near the apex). */
const JUMP_SECONDS = (() => {
  let vy = C.JUMP_V, y = 0, t = 0;
  do { vy -= Math.abs(vy) < C.HANG_V ? C.HANG_GRAVITY : C.GRAVITY; y += vy; t++; } while (y > 0);
  return t / C.TICK_HZ;
})();

export interface CharacterInfo {
  id: string;
  name: string;
  file?: string;
  scale?: number;
  colors: { accent: string; body: string };
}

/** Built-in characters; characters.json (if present) overrides them by id. */
export const DEFAULT_CHARACTERS: CharacterInfo[] = [
  // placeholder looks follow the picked concepts: boy = charcoal hoodie + cyan, girl = coral/navy + cyan trim
  { id: "boy", name: "Kai", colors: { accent: "#4fe3ff", body: "#5a5f72" } },
  { id: "girl", name: "Nova", colors: { accent: "#ff7a63", body: "#34488c" } },
];

export async function loadCharacters(): Promise<CharacterInfo[]> {
  try {
    const r = await fetch("/characters/characters.json");
    if (!r.ok) return DEFAULT_CHARACTERS;
    const list = (await r.json()) as CharacterInfo[];
    return DEFAULT_CHARACTERS.map((d) => {
      const c = list.find((x) => x.id === d.id);
      return c ? { ...d, ...c, colors: { ...d.colors, ...c.colors } } : d;
    });
  } catch {
    return DEFAULT_CHARACTERS;
  }
}

export interface CharacterView {
  readonly object: THREE.Object3D;
  /** Pose the character for the current game state. dt = seconds since the last frame. */
  update(g: Game | null, dt: number): void;
}

export async function makeCharacter(info: CharacterInfo): Promise<CharacterView> {
  if (info.file) {
    try {
      return await GlbCharacter.load(info);
    } catch (e) {
      console.warn(`character ${info.id}: ${info.file} failed to load, using the placeholder`, e);
    }
  }
  return new PlaceholderCharacter(info);
}

export const placeholderCharacter = (info: CharacterInfo): CharacterView => new PlaceholderCharacter(info);

/** A stylized courier from capsules: body, head, backpack, swinging arms and legs. */
class PlaceholderCharacter implements CharacterView {
  readonly object = new THREE.Group();
  private body = new THREE.Group();
  private legs: THREE.Mesh[] = [];
  private arms: THREE.Mesh[] = [];
  private phase = 0;

  constructor(info: CharacterInfo) {
    const accent = new THREE.Color(info.colors.accent);
    const suit = new THREE.MeshStandardMaterial({ color: info.colors.body, roughness: 0.6 });
    const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8, roughness: 0.4 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a27e, roughness: 0.7 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 6, 12), suit);
    torso.position.y = 1.15;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.025, 6, 20), glow);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
    head.position.y = 1.62;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), suit);
    cap.position.y = 1.65;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.16), glow);
    visor.position.set(0, 1.66, -0.16);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.22), suit);
    pack.position.set(0, 1.2, 0.24);
    const packLight = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.01), glow);
    packLight.position.set(0, 1.3, 0.36);
    this.body.add(torso, stripe, head, cap, visor, pack, packLight);
    if (info.id === "girl") {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2b1a14 }));
      tail.position.set(0, 1.55, 0.2);
      tail.rotation.x = 0.6;
      this.body.add(tail);
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 4, 8), suit);
      leg.geometry.translate(0, -0.33, 0);
      leg.position.set(side * 0.11, 0.8, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 8), suit);
      arm.geometry.translate(0, -0.25, 0);
      arm.position.set(side * 0.3, 1.38, 0);
      this.legs.push(leg);
      this.arms.push(arm);
      this.body.add(leg, arm);
    }
    this.object.add(this.body);
  }

  update(g: Game | null, dt: number): void {
    const running = g && !g.dead && g.tick > 0;
    const speed = g ? g.speed / C.START_SPEED : 1;
    this.phase += dt * (running ? 11 * speed : 2);
    const s = Math.sin(this.phase);
    const air = g ? !g.grounded : false;
    const roll = g ? g.rolling : false;
    for (let i = 0; i < 2; i++) {
      const sign = i ? 1 : -1;
      this.legs[i].rotation.x = air ? (i ? -0.9 : 0.5) : running ? sign * s * 0.9 : 0;
      this.arms[i].rotation.x = air ? -2.4 : running ? -sign * s * 0.8 : 0.1 * Math.sin(this.phase);
    }
    this.body.position.y = running && !air ? Math.abs(s) * 0.06 : 0;
    // rolling: tuck into a ball; dead: fall over
    this.body.scale.y = roll ? 0.48 : 1;
    this.body.rotation.x = roll ? -0.4 : 0;
    if (g?.dead) this.body.rotation.x = Math.min(this.body.rotation.x + dt * 6, Math.PI / 2);
    // lean into lane changes
    if (g) this.object.rotation.z = THREE.MathUtils.clamp((g.x - (g.lane - 1) * C.LANE_WIDTH) / C.LANE_WIDTH, -1, 1) * 0.35;
  }
}

/** A rigged GLB with clips idle/run/jump/roll/crash (full body) and laneLeft/laneRight/stumble
 *  (spine and head only, layered additively over the run). Jump and roll are in place: the game
 *  moves the model. Glow maps are toned down to fit the readable lighting. */
class GlbCharacter implements CharacterView {
  readonly object = new THREE.Group();
  private mixer!: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationAction>();
  private layers = new Map<string, THREE.AnimationAction>();
  private current = "";
  private lastLane = -1;
  private lastSlow = 0;

  static async load(info: CharacterInfo): Promise<GlbCharacter> {
    const c = new GlbCharacter();
    const gltf = await new GLTFLoader().loadAsync(`/characters/${info.file}`);
    gltf.scene.scale.setScalar(info.scale ?? 1);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity *= 0.45;
      }
    });
    c.object.add(gltf.scene);
    c.mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      if (["laneLeft", "laneRight", "stumble"].includes(clip.name)) {
        const additive = THREE.AnimationUtils.makeClipAdditive(clip.clone());
        const a = c.mixer.clipAction(additive);
        a.blendMode = THREE.AdditiveAnimationBlendMode;
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = false;
        c.layers.set(clip.name, a);
      } else {
        const a = c.mixer.clipAction(clip);
        if (["jump", "roll", "crash"].includes(clip.name)) {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
        }
        c.clips.set(clip.name, a);
      }
    }
    c.play("idle");
    return c;
  }

  private play(name: string, fade = 0.12): void {
    if (name === this.current || !this.clips.has(name)) return;
    const next = this.clips.get(name)!;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.clips.get(this.current)!, fade, false);
    this.current = name;
  }

  private layer(name: string): void {
    this.layers.get(name)?.reset().play();
  }

  update(g: Game | null, dt: number): void {
    if (!g || g.tick === 0) this.play("idle");
    else if (g.dead) this.play("crash", 0.08);
    else if (g.rolling) this.play("roll", 0.06);
    else if (!g.grounded) this.play("jump", 0.06);
    else this.play("run", 0.15); // coming out of roll: the run clip restores full scale
    if (g && !g.dead) {
      if (this.lastLane >= 0 && g.lane !== this.lastLane) this.layer(g.lane < this.lastLane ? "laneLeft" : "laneRight");
      if (g.slowTicks > this.lastSlow) this.layer("stumble");
      this.lastLane = g.lane;
      this.lastSlow = g.slowTicks;
    }
    const run = this.clips.get("run");
    if (run && g) run.timeScale = g.currentSpeed / C.START_SPEED;
    const jump = this.clips.get("jump");
    if (jump) jump.timeScale = 0.6 / JUMP_SECONDS; // the clip is 0.6 s; the jump now lasts ~0.76 s
    this.mixer.update(dt);
  }
}
