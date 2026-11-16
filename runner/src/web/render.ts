// Draws a Game with three.js. It only reads the game state; it never changes it.
// World units are metres; the runner stays at z = 0 and the world moves toward the camera (+z).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import * as C from "../core/config";
import type { Game, Obstacle, Pickup } from "../core/game";
import { DEFAULT_CHARACTERS, placeholderCharacter, type CharacterView } from "./character";
import { City } from "./city";
import { Effects } from "./effects";
import { Ghost } from "./ghost";
import { gravelTexture, hazardTexture, lightPoolTexture, signTexture, skyTexture } from "./textures";

const M = 1 / 1000; // mm -> m
const W = C.OBSTACLE_W * M;
const SLEEPER = 0.9; // metres between rail sleepers

// Colour coding, so every obstacle reads at a glance:
//   low barrier (jump) = yellow   high barrier (roll) = orange-red   train = steel blue + white headlights
//   oncoming train = red + flashing lights   ramp = green edges ("go up here")
const COL = {
  fog: 0x4a3f86,
  train: 0x3a4f8f,
  trainRoof: 0x2a3866,
  stripe: 0x4fe3ff,
  moving: 0xff3b5c,
  window: 0xffe9b8,
  rail: 0x5e6886,
  coin: 0xffc93c,
  magnet: 0x4fe3ff,
  spring: 0x7dff6a,
  double: 0xff4fd8,
  low: 0xffd23f,
  barrier: 0xff5a2d,
  ramp: 0x3dffa8,
  laneGlow: 0x6fd8ff,
};

export interface RendererOptions {
  bloom?: boolean;
  character?: CharacterView;
  seed?: number; // for the city's look
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private meshes = new Map<number, THREE.Object3D>();
  private character: CharacterView;
  private sleepers: THREE.InstancedMesh;
  private bed: THREE.Mesh;
  private city: City;
  private ghost = new Ghost();
  private effects = new Effects();
  private lastTime = performance.now();
  private endShift = 0; // 0..1: after a crash the view slides up, so the runner sits above the card
  private size = { w: 1, h: 1 };
  private mat: Record<string, THREE.Material>;
  private key: THREE.SpotLight;
  private rim: THREE.SpotLight;
  private pools: THREE.Mesh[] = [];
  private geo: Record<string, THREE.BufferGeometry>;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(COL.fog, 110, 240); // only the far distance fades

    // blue hour: a bright sky dome and a cool fill, so streets, walls and sky read clearly
    this.scene.add(new THREE.HemisphereLight(0xb4c4ff, 0x4a3a66, 2.2));
    this.scene.add(new THREE.AmbientLight(0x8890c0, 0.6));
    const moon = new THREE.DirectionalLight(0xd6defc, 1.6);
    moon.position.set(-6, 14, 8);
    this.scene.add(moon);

    // the runner is always the clearest thing on screen: a soft warm key from the camera side,
    // and a cool rim light from ahead so the silhouette pops off the track
    this.key = new THREE.SpotLight(0xfff1dc, 70, 14, 0.55, 0.7, 1.6);
    this.rim = new THREE.SpotLight(0x9fe6ff, 120, 14, 0.6, 0.6, 1.6);
    for (const l of [this.key, this.rim]) {
      this.scene.add(l, l.target);
    }

    this.mat = makeMaterials();
    this.geo = {
      body: new THREE.BoxGeometry(W, C.TRAIN.height * M * 0.92, C.TRAIN.len * M),
      roof: new THREE.BoxGeometry(W * 0.9, C.TRAIN.height * M * 0.08, C.TRAIN.len * M * 0.98),
      band: new THREE.PlaneGeometry(C.TRAIN.len * M * 0.94, 0.9),
      stripe: new THREE.PlaneGeometry(C.TRAIN.len * M, 0.14),
      face: new THREE.PlaneGeometry(W * 0.86, 1.1),
      light: new THREE.CircleGeometry(0.16, 16),
      low: new THREE.BoxGeometry(W, C.LOW_BARRIER.y1 * M * 0.85, C.LOW_BARRIER.len * M),
      lowLeg: new THREE.BoxGeometry(0.12, C.LOW_BARRIER.y1 * M, 0.5),
      beam: new THREE.BoxGeometry(W + 0.3, 0.55, 0.3),
      tube: new THREE.BoxGeometry(W, 0.08, 0.08),
      post: new THREE.BoxGeometry(0.16, C.HIGH_BARRIER.y1 * M, 0.16),
      ramp: rampGeometry(),
      rampEdge: new THREE.BoxGeometry(0.06, 0.06, Math.hypot(C.RAMP_LEN, C.TRAIN.height) * M),
      coin: new THREE.CylinderGeometry(0.3, 0.3, 0.07, 24),
      coinRim: new THREE.TorusGeometry(0.3, 0.035, 8, 24),
      power: new THREE.IcosahedronGeometry(0.42, 0),
    };

    // track bed, rails and sleepers
    const gravel = gravelTexture();
    gravel.repeat.set(4, 120);
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(C.LANES * C.LANE_WIDTH * M + 2.4, 260), new THREE.MeshStandardMaterial({ map: gravel, roughness: 0.95 }));
    this.bed.rotation.x = -Math.PI / 2;
    this.bed.position.z = -110;
    this.scene.add(this.bed);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(60, 260), new THREE.MeshStandardMaterial({ color: 0x2c2c48, roughness: 0.45, metalness: 0.3 }));
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, -0.02, -110);
    this.scene.add(street);
    const nSleep = Math.ceil(240 / SLEEPER) * C.LANES;
    this.sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.08, 0.22), new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.9 }), nSleep);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let lane = 0; lane < C.LANES; lane++) for (let i = 0; i < nSleep / C.LANES; i++) {
      m4.makeTranslation((lane - 1) * C.LANE_WIDTH * M, 0.04, 20 - i * SLEEPER);
      this.sleepers.setMatrixAt(k++, m4);
    }
    this.scene.add(this.sleepers);
    for (let lane = 0; lane < C.LANES; lane++) for (const side of [-0.55, 0.55]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 260), this.mat.rail);
      rail.position.set((lane - 1) * C.LANE_WIDTH * M + side, 0.1, -110);
      this.scene.add(rail);
    }
    // lit lane edges guide the eye down the track
    for (const e of [-1.5, -0.5, 0.5, 1.5]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 260), this.mat.laneGlow);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(e * C.LANE_WIDTH * M, 0.02, -110);
      this.scene.add(strip);
    }
    // warm pools of street light along the path (scroll with the lamps)
    const poolTex = lightPoolTexture();
    for (let i = 0; i < 12; i++) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.03;
      this.scene.add(pool);
      this.pools.push(pool);
    }

    this.city = new City(opts.seed ?? 1);
    this.scene.add(this.city.group, this.ghost.object, this.ghost.stars, this.effects.group);
    this.character = opts.character ?? placeholderCharacter(DEFAULT_CHARACTERS[0]);
    this.scene.add(this.character.object);

    if (opts.bloom !== false) {
      this.composer = new EffectComposer(this.gl);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.3, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.camera.position.set(0, 3.2, 6.5);
  }

  /** Slide the view up after a crash (the game page shows a card over the lower part). */
  endShiftOn = false;

  setCharacter(view: CharacterView): void {
    this.scene.remove(this.character.object);
    this.character = view;
    this.scene.add(view.object);
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h); // also sets the CSS size; without it, high-DPI phones show only a corner
    this.size = { w, h };
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the 3 lanes in view on tall screens (phones, vertical video): fix the horizontal angle
    const hfov = 78 * (Math.PI / 180);
    const vfov = (2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = Math.max(62, Math.min(100, vfov));
    this.camera.updateProjectionMatrix();
  }

  /** Draw a frame. `dt` (seconds) drives animation only; pass a fixed value when rendering video. */
  draw(g: Game, dt?: number): void {
    const now = performance.now();
    const step = dt ?? Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const seen = new Set<number>();
    for (const o of g.obstacles) {
      const dz = (o.z0 - g.z) * M;
      if (dz > C.VIEW_DISTANCE * M + 30 || (o.z1 - g.z) * M < -15) continue;
      // barriers vanish once broken or behind the runner: they would sweep across the camera
      if ((o.kind === "low" || o.kind === "high") && (o.broken || o.z1 < g.z - C.PLAYER_LEN)) continue;
      seen.add(o.id);
      const m = this.meshes.get(o.id) ?? this.addObstacle(o);
      m.position.z = -dz;
    }
    for (const p of g.pickups) {
      if (p.taken) continue;
      const dz = (p.z - g.z) * M;
      if (dz > C.VIEW_DISTANCE * M + 30 || dz < -0.8) continue; // gone once behind the runner
      seen.add(p.id);
      const m = this.meshes.get(p.id) ?? this.addPickup(p);
      m.position.z = -dz;
      m.rotation.y = (g.tick + p.id * 7) * 0.06;
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.meshes.delete(id);
      }
    }

    const trackM = g.z * M;
    this.sleepers.position.z = trackM % SLEEPER;
    this.city.update(trackM);
    this.city.setDim(Ghost.closeness(g));
    this.ghost.update(g, step, this.camera.aspect < 0.75 ? 4.8 : 6.5);
    this.effects.update(g, step);
    this.pools.forEach((p, i) => {
      p.position.x = i % 2 ? 4.2 : -4.2;
      p.position.z = -((i * 18 - (trackM % 36) + 360) % 216) + 20;
    });

    const px = g.x * M, py = g.y * M;
    this.key.position.set(px + 1.6, py + 4.2, 3.2);
    this.key.target.position.set(px, py + 1, 0);
    this.rim.position.set(px - 0.6, py + 3.4, -3.6);
    this.rim.target.position.set(px, py + 1.1, 0);

    this.character.object.position.set(g.x * M, g.y * M, 0);
    const sq = this.effects.squash; // stretch on take-off
    this.character.object.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.character.update(g, step);
    // no blinking after a stumble: the runner stays visible; the stumble clip and the ghost show the hit

    // chase camera: behind and above, following the runner smoothly. On tall screens (phones,
    // vertical video) it sits closer and lower, so the runner is bigger without hiding the track ahead.
    const portrait = this.camera.aspect < 0.75;
    const cx = g.x * M * 0.6, cy = (portrait ? 2.6 : 3.2) + g.y * M * 0.85;
    const k = 1 - Math.pow(0.0005, step);
    this.camera.position.x += (cx - this.camera.position.x) * k;
    this.camera.position.y += (cy - this.camera.position.y) * k;
    this.camera.position.z = portrait ? 4.8 : 6.5;
    this.camera.lookAt(g.x * M * 0.4, (portrait ? 1.1 : 1.3) + g.y * M * 0.85, -8);
    // end of run: ease the picture up (a view offset, no camera move), so the crash scene shows above the card
    this.endShift += ((g.dead && this.endShiftOn ? 1 : 0) - this.endShift) * Math.min(1, step * 3);
    if (this.endShift > 0.001) this.camera.setViewOffset(this.size.w, this.size.h, 0, this.endShift * 0.3 * this.size.h, this.size.w, this.size.h);
    else this.camera.clearViewOffset();
    if (this.composer) this.composer.render(step);
    else this.gl.render(this.scene, this.camera);
  }

  private addObstacle(o: Obstacle): THREE.Object3D {
    const g = new THREE.Group();
    const add = (geo: string, mat: string, x: number, y: number, z: number, rot?: [number, number, number]) => {
      const m = new THREE.Mesh(this.geo[geo], this.mat[mat]);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(...rot);
      g.add(m);
      return m;
    };
    if (o.kind === "train") {
      const h = C.TRAIN.height * M, len = C.TRAIN.len * M;
      add("body", "train", 0, h * 0.46, -len / 2);
      add("roof", "trainRoof", 0, h * 0.96, -len / 2);
      for (const side of [-1, 1]) {
        add("band", "window", side * (W / 2 + 0.005), h * 0.62, -len / 2, [0, side * Math.PI / 2, 0]);
        add("stripe", o.moving ? "movingGlow" : "stripe", side * (W / 2 + 0.006), h * 0.32, -len / 2, [0, side * Math.PI / 2, 0]);
      }
      add("face", o.moving ? "movingFace" : "trainFace", 0, h * 0.62, 0.005);
      for (const lx of [-0.55, 0.55]) add("light", o.moving ? "headlight" : "tailLight", lx, h * 0.25, 0.01);
    } else if (o.kind === "low") {
      const h = C.LOW_BARRIER.y1 * M;
      add("low", "hazard", 0, h * 0.55, -(C.LOW_BARRIER.len * M) / 2);
      for (const lx of [-0.8, 0.8]) add("lowLeg", "dark", lx, h / 2, -(C.LOW_BARRIER.len * M) / 2);
    } else if (o.kind === "high") {
      const y0 = C.HIGH_BARRIER.y0 * M, y1 = C.HIGH_BARRIER.y1 * M;
      for (const px of [-W / 2, W / 2]) add("post", "dark", px, y1 / 2, -0.2);
      add("beam", "high", 0, y0 + 0.4, -0.2);
      add("tube", "barrierGlow", 0, y0 + 0.08, -0.05);
      add("beam", "dark", 0, y1 - 0.3, -0.2);
    } else {
      add("ramp", "ramp", 0, 0, 0);
      const ang = Math.atan2(C.TRAIN.height, C.RAMP_LEN);
      for (const ex of [-W / 2, W / 2]) add("rampEdge", "rampEdge", ex, (C.TRAIN.height * M) / 2, -(C.RAMP_LEN * M) / 2, [ang, 0, 0]);
    }
    g.position.x = (o.lane - 1) * C.LANE_WIDTH * M;
    this.scene.add(g);
    this.meshes.set(o.id, g);
    return g;
  }

  private addPickup(p: Pickup): THREE.Object3D {
    const wrap = new THREE.Group();
    if (p.kind === "coin") {
      const coin = new THREE.Mesh(this.geo.coin, this.mat.coin);
      coin.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(this.geo.coinRim, this.mat.coinRim);
      wrap.add(coin, rim);
    } else {
      wrap.add(new THREE.Mesh(this.geo.power, this.mat[p.kind]));
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: powerLabel(p.kind), depthWrite: false }));
      label.scale.set(1.2, 0.3, 1);
      label.position.y = 0.8;
      wrap.add(label);
    }
    wrap.position.set((p.lane - 1) * C.LANE_WIDTH * M, p.y * M, 0);
    this.scene.add(wrap);
    this.meshes.set(p.id, wrap);
    return wrap;
  }
}

function makeMaterials(): Record<string, THREE.Material> {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.55, ...o });
  const glow = (color: number, i = 2.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.4 });
  const hz = hazardTexture();
  hz.wrapS = THREE.RepeatWrapping;
  hz.repeat.set(2, 1);
  return {
    train: std({ color: COL.train, metalness: 0.35, roughness: 0.4 }),
    trainRoof: std({ color: COL.trainRoof, metalness: 0.4 }),
    window: glow(COL.window, 0.6),
    stripe: glow(COL.stripe, 0.9),
    movingGlow: glow(COL.moving, 1.2),
    trainFace: std({ color: 0x223058, metalness: 0.5, roughness: 0.25 }),
    movingFace: glow(COL.moving, 0.5),
    headlight: glow(0xfff1d6, 1.3),
    tailLight: glow(0xff2a3a, 1.3),
    hazard: std({ map: hz, emissive: COL.low, emissiveIntensity: 0.12 }),
    high: std({ color: COL.barrier, emissive: COL.barrier, emissiveIntensity: 0.25, roughness: 0.5 }),
    dark: std({ color: 0x4a4e66, metalness: 0.5 }),
    barrierGlow: glow(COL.barrier, 0.9),
    ramp: std({ color: 0x4c5a86, metalness: 0.4, roughness: 0.5 }),
    rampEdge: glow(COL.ramp, 0.9),
    laneGlow: new THREE.MeshBasicMaterial({ color: COL.laneGlow, transparent: true, opacity: 0.45 }),
    rail: std({ color: COL.rail, metalness: 0.3, roughness: 0.75 }), // matte enough not to flare under the key light
    coin: std({ color: COL.coin, emissive: COL.coin, emissiveIntensity: 0.45, metalness: 0.8, roughness: 0.3 }),
    coinRim: glow(0xfff1b0, 0.7),
    magnet: glow(COL.magnet, 0.8),
    spring: glow(COL.spring, 0.8),
    double: glow(COL.double, 0.8),
  };
}

const labels = new Map<string, THREE.Texture>();
function powerLabel(kind: string): THREE.Texture {
  const text = kind === "magnet" ? "MAGNET" : kind === "spring" ? "SPRING" : "2X COINS";
  const color = kind === "magnet" ? "#4fe3ff" : kind === "spring" ? "#7dff6a" : "#ff4fd8";
  if (!labels.has(kind)) labels.set(kind, signTexture(text, color));
  return labels.get(kind)!;
}

/** A wedge: rises from the ground at its near end to the train roof at its far end. */
function rampGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const len = C.RAMP_LEN * M, h = C.TRAIN.height * M;
  shape.moveTo(0, 0);
  shape.lineTo(len, 0);
  shape.lineTo(len, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  // shape x -> world -z (forward), shape y -> up, extrude depth -> world x
  g.rotateY(Math.PI / 2);
  g.translate(-W / 2, 0, 0);
  return g;
}
