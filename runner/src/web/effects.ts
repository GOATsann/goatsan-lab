// Feedback you can see: coins fly into the runner, "x2" pops, the magnet ring, the spring trail,
// the shield bubble (pops on a hit), pickup bursts. Visual only: it watches the game state change.
import * as THREE from "three";
import * as C from "../core/config";
import type { Game } from "../core/game";
import { signTexture } from "./textures";

const M = 1 / 1000;

interface Flyer { obj: THREE.Object3D; from: THREE.Vector3; t: number; dur: number }
interface Pop { obj: THREE.Sprite | THREE.Mesh; t: number; dur: number; grow: number; rise: number }

export class Effects {
  readonly group = new THREE.Group();
  private seen = new Set<number>(); // pickups already taken
  private flyers: Flyer[] = [];
  private pops: Pop[] = [];
  private magnetRing: THREE.Mesh;
  private x2Badge: THREE.Sprite;
  private bubble: THREE.Mesh;
  private trail: THREE.Points;
  private trailPos: Float32Array;
  private trailHead = 0;
  private lastShield = 0;
  private lastGrounded = true;
  private coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16);
  private coinMat = new THREE.MeshStandardMaterial({ color: 0xffc93c, emissive: 0xffc93c, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 });
  private x2 = signTexture("x2", "#ff4fd8");
  private burstTex = ringTexture();
  private t = 0;
  /** squash-and-stretch for the runner model (1 = none); read by the renderer */
  squash = 1;

  constructor() {
    this.magnetRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 40), new THREE.MeshStandardMaterial({ color: 0x4fe3ff, emissive: 0x4fe3ff, emissiveIntensity: 0.8 }));
    this.magnetRing.rotation.x = Math.PI / 2;
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1.15, 32, 20), new THREE.MeshStandardMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.2, emissive: 0x4fa8ff, emissiveIntensity: 0.25, depthWrite: false,
    }));
    const n = 40;
    this.trailPos = new Float32Array(n * 3).fill(-1000);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7dff6a, size: 0.16, map: dotTexture(), transparent: true, opacity: 0.9, depthWrite: false, alphaTest: 0.05 }));
    this.x2Badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.x2, depthWrite: false, transparent: true }));
    this.x2Badge.scale.set(0.9, 0.23, 1);
    this.group.add(this.magnetRing, this.bubble, this.trail, this.x2Badge);
  }

  update(g: Game, dt: number): void {
    this.t += dt;
    const runner = new THREE.Vector3(g.x * M, g.y * M + 1, 0);

    // pickups that just got taken: coins fly in, power-ups burst
    for (const p of g.pickups) {
      if (!p.taken || this.seen.has(p.id)) continue;
      this.seen.add(p.id);
      const from = new THREE.Vector3((p.lane - 1) * C.LANE_WIDTH * M, p.y * M, -(p.z - g.z) * M);
      if (p.kind === "coin") {
        const coin = new THREE.Mesh(this.coinGeo, this.coinMat);
        coin.rotation.x = Math.PI / 2;
        coin.position.copy(from);
        this.group.add(coin);
        this.flyers.push({ obj: coin, from, t: 0, dur: from.distanceTo(runner) > 6 ? 0.35 : 0.18 });
        if (g.doubleTicks > 0) this.pop(new THREE.Sprite(new THREE.SpriteMaterial({ map: this.x2, depthWrite: false })), runner.clone().add(new THREE.Vector3(0.5, 0.9, 0)), 0.6, 0.6, 0.8);
      } else {
        const color = p.kind === "magnet" ? 0x4fe3ff : p.kind === "spring" ? 0x7dff6a : p.kind === "double" ? 0xff4fd8 : 0x9fd8ff;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 40), new THREE.MeshBasicMaterial({ map: this.burstTex, color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        this.pop(ring, runner.clone(), 0.45, 4, 0);
      }
    }
    if (this.seen.size > 400) this.seen = new Set([...this.seen].slice(-200));

    for (const f of this.flyers) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur), e = k * k;
      f.obj.position.lerpVectors(f.from, runner, e);
      f.obj.position.y += Math.sin(k * Math.PI) * 0.6;
      f.obj.rotation.z += dt * 20;
      f.obj.scale.setScalar(1 - 0.6 * k);
    }
    this.flyers = this.flyers.filter((f) => {
      if (f.t < f.dur) return true;
      this.group.remove(f.obj);
      return false;
    });
    for (const p of this.pops) {
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      p.obj.scale.setScalar((p.obj instanceof THREE.Sprite ? 1 : 1) * (1 + p.grow * k) * (p.obj instanceof THREE.Sprite ? 0.6 : 1));
      p.obj.position.y += p.rise * dt;
      (p.obj.material as THREE.Material & { opacity: number }).opacity = 1 - k;
      if (!(p.obj instanceof THREE.Sprite)) p.obj.lookAt(0, 3.2, 6.5);
    }
    this.pops = this.pops.filter((p) => {
      if (p.t < p.dur) return true;
      this.group.remove(p.obj);
      return false;
    });

    // double coins: an x2 badge over the head
    this.x2Badge.visible = g.doubleTicks > 0 && !g.dead;
    this.x2Badge.position.set(g.x * M, g.y * M + 2.15 + Math.sin(this.t * 4) * 0.05, 0);

    // magnet: a spinning ring at the feet
    this.magnetRing.visible = g.magnetTicks > 0 && !g.dead;
    this.magnetRing.position.set(g.x * M, g.y * M + 0.08 + Math.sin(this.t * 6) * 0.04, 0);
    this.magnetRing.rotation.z += dt * 4;

    // shield: a bubble; pops when it absorbs a hit
    const shield = g.shieldTicks > 0 && !g.dead;
    this.bubble.visible = shield;
    this.bubble.position.set(g.x * M, g.y * M + 0.95, 0);
    this.bubble.scale.setScalar(1 + Math.sin(this.t * 5) * 0.02);
    if (this.lastShield > 0 && g.shieldTicks === 0 && g.graceTicks > 0) {
      const burst = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 16), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.5, depthWrite: false }));
      this.pop(burst, this.bubble.position.clone(), 0.3, 0.8, 0);
    }
    this.lastShield = g.shieldTicks;

    // spring shoes: a green sparkle trail in the air, and a stretch on take-off
    const head = this.trailHead++ % (this.trailPos.length / 3);
    // sparkles at the feet the whole time; every frame in the air, every other frame on the ground
    const sparkle = g.springTicks > 0 && !g.dead && (!g.grounded || head % 2 === 0);
    const j1 = Math.sin(head * 12.9898) * 0.5, j2 = Math.sin(head * 78.233) * 0.5; // fixed jitter: videos render the same every time
    this.trailPos.set(sparkle ? [g.x * M + j1 * 0.3, g.y * M + 0.2, 0.3 + (j2 + 0.5) * 0.2] : [0, -1000, 0], head * 3);
    for (let i = 0; i < this.trailPos.length; i += 3) this.trailPos[i + 2] += (g.currentSpeed * M * 60) * dt; // sparkles stay behind
    this.trail.geometry.attributes.position.needsUpdate = true;
    const takeoff = this.lastGrounded && !g.grounded && g.vy > 0;
    if (takeoff) this.squash = g.springTicks > 0 ? 1.3 : 1.12;
    this.squash += (1 - this.squash) * Math.min(1, dt * 8);
    this.lastGrounded = g.grounded;
  }

  private pop(obj: THREE.Sprite | THREE.Mesh, at: THREE.Vector3, dur: number, grow: number, rise: number): void {
    obj.position.copy(at);
    this.group.add(obj);
    this.pops.push({ obj, t: 0, dur, grow, rise });
  }
}

/** A soft round dot, so trail sparkles are round, not square. */
function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function ringTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 10, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
