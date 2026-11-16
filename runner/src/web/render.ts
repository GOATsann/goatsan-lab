// Draws a Game with three.js. It only reads the game state; it never changes it.
// World units are metres; the runner stays at z = 0 and the world moves toward the camera.
import * as THREE from "three";
import * as C from "../core/config";
import type { Game, Obstacle, Pickup } from "../core/game";

const M = 1 / 1000; // mm -> m

const PALETTE = {
  sky: 0x07080f,
  ground: 0x141826,
  laneLine: 0x2a3150,
  low: 0xe0b23a,
  high: 0xe05a3a,
  train: 0x3a4a8c,
  movingTrain: 0xc2304a,
  ramp: 0x5b6a9e,
  coin: 0xffd23f,
  magnet: 0x4fd1ff,
  spring: 0x7dff6a,
  double: 0xff6ad5,
  runner: 0xf2f4ff,
};

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
  readonly gl: THREE.WebGLRenderer;
  private meshes = new Map<number, THREE.Object3D>();
  private runner: THREE.Mesh;
  private ground: THREE.Mesh;
  private lines: THREE.Mesh[] = [];
  private geo = {
    low: new THREE.BoxGeometry(C.OBSTACLE_W * M, C.LOW_BARRIER.y1 * M, C.LOW_BARRIER.len * M),
    high: new THREE.BoxGeometry(C.OBSTACLE_W * M, (C.HIGH_BARRIER.y1 - C.HIGH_BARRIER.y0) * M, C.HIGH_BARRIER.len * M),
    post: new THREE.BoxGeometry(0.15, C.HIGH_BARRIER.y0 * M, 0.15),
    train: new THREE.BoxGeometry(C.OBSTACLE_W * M, C.TRAIN.height * M, C.TRAIN.len * M),
    ramp: rampGeometry(),
    coin: new THREE.CylinderGeometry(0.35, 0.35, 0.08, 20),
    power: new THREE.IcosahedronGeometry(0.45),
  };
  private mat = Object.fromEntries(
    Object.entries(PALETTE).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1 })]),
  ) as Record<keyof typeof PALETTE, THREE.MeshStandardMaterial>;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.sky, 40, 100);
    this.scene.add(new THREE.HemisphereLight(0xb8c4ff, 0x10121c, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 10, 6);
    this.scene.add(sun);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 220), this.mat.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.z = -90;
    this.scene.add(this.ground);
    for (const x of [-1.5, -0.5, 0.5, 1.5]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 220), new THREE.MeshBasicMaterial({ color: PALETTE.laneLine }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(x * C.LANE_WIDTH * M, 0.01, -90);
      this.scene.add(line);
      this.lines.push(line);
    }
    this.runner = new THREE.Mesh(new THREE.BoxGeometry(C.PLAYER_W * M, 1, C.PLAYER_LEN * M), this.mat.runner);
    this.scene.add(this.runner);
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the 3 lanes in view on tall screens (phones, vertical video): fix the horizontal angle
    const hfov = 78 * (Math.PI / 180);
    const vfov = (2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = Math.max(62, Math.min(100, vfov));
    this.camera.updateProjectionMatrix();
  }

  draw(g: Game): void {
    const seen = new Set<number>();
    for (const o of g.obstacles) {
      const dz = (o.z0 - g.z) * M;
      if (dz > C.VIEW_DISTANCE * M || (o.z1 - g.z) * M < -15) continue;
      seen.add(o.id);
      const m = this.meshes.get(o.id) ?? this.addObstacle(o);
      m.position.z = -(o.z0 - g.z) * M;
    }
    for (const p of g.pickups) {
      if (p.taken) continue;
      const dz = (p.z - g.z) * M;
      if (dz > C.VIEW_DISTANCE * M || dz < -5) continue;
      seen.add(p.id);
      const m = this.meshes.get(p.id) ?? this.addPickup(p);
      m.position.z = -dz;
      m.rotation.y = (g.tick + p.id * 7) * 0.05;
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.meshes.delete(id);
      }
    }

    const h = (g.rolling ? C.PLAYER_ROLL_H : C.PLAYER_H) * M;
    this.runner.scale.y = h;
    this.runner.position.set(g.x * M, g.y * M + h / 2, 0);
    this.runner.material = g.stumbleTicks > 0 && (g.tick >> 2) % 2 ? this.mat.high : this.mat.runner;

    // lane lines scroll so the motion reads even on an empty stretch
    const scroll = ((g.z * M) % 4);
    for (const l of this.lines) l.position.z = -90 + scroll;

    // chase camera: behind and above, following the runner smoothly
    const cx = g.x * M * 0.6, cy = 3.2 + g.y * M * 0.8;
    this.camera.position.x += (cx - this.camera.position.x) * 0.2;
    this.camera.position.y += (cy - this.camera.position.y) * 0.15;
    this.camera.position.z = 6.5;
    this.camera.lookAt(g.x * M * 0.4, 1.2 + g.y * M * 0.8, -8);
    this.gl.render(this.scene, this.camera);
  }

  private addObstacle(o: Obstacle): THREE.Object3D {
    const x = (o.lane - 1) * C.LANE_WIDTH * M;
    const group = new THREE.Group();
    if (o.kind === "low") {
      const m = new THREE.Mesh(this.geo.low, this.mat.low);
      m.position.set(0, (C.LOW_BARRIER.y1 * M) / 2, -(C.LOW_BARRIER.len * M) / 2);
      group.add(m);
    } else if (o.kind === "high") {
      const m = new THREE.Mesh(this.geo.high, this.mat.high);
      m.position.set(0, ((C.HIGH_BARRIER.y0 + C.HIGH_BARRIER.y1) / 2) * M, -(C.HIGH_BARRIER.len * M) / 2);
      group.add(m);
      for (const px of [-0.9, 0.9]) {
        const post = new THREE.Mesh(this.geo.post, this.mat.high);
        post.position.set(px, (C.HIGH_BARRIER.y0 * M) / 2, -(C.HIGH_BARRIER.len * M) / 2);
        group.add(post);
      }
    } else if (o.kind === "train") {
      const m = new THREE.Mesh(this.geo.train, o.moving ? this.mat.movingTrain : this.mat.train);
      m.position.set(0, (C.TRAIN.height * M) / 2, -(C.TRAIN.len * M) / 2);
      group.add(m);
    } else {
      group.add(new THREE.Mesh(this.geo.ramp, this.mat.ramp));
    }
    group.position.x = x;
    this.scene.add(group);
    this.meshes.set(o.id, group);
    return group;
  }

  private addPickup(p: Pickup): THREE.Object3D {
    const m = p.kind === "coin"
      ? new THREE.Mesh(this.geo.coin, this.mat.coin)
      : new THREE.Mesh(this.geo.power, this.mat[p.kind]);
    if (p.kind === "coin") m.rotation.x = Math.PI / 2;
    const wrap = new THREE.Group();
    wrap.add(m);
    wrap.position.set((p.lane - 1) * C.LANE_WIDTH * M, p.y * M, 0);
    this.scene.add(wrap);
    this.meshes.set(p.id, wrap);
    return wrap;
  }
}

/** A wedge: rises from the ground at its near end to the train roof at its far end. */
function rampGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const len = C.RAMP_LEN * M, h = C.TRAIN.height * M;
  shape.moveTo(0, 0);
  shape.lineTo(len, 0);
  shape.lineTo(len, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: C.OBSTACLE_W * M, bevelEnabled: false });
  // shape x -> world -z (forward), shape y -> up, extrude depth -> world x
  g.rotateY(Math.PI / 2);
  g.translate(-(C.OBSTACLE_W * M) / 2, 0, 0);
  return g;
}
