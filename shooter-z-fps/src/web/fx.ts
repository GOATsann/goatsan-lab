// Effects: laser beams with a glow, muzzle flashes, hit sparks, impact glows, elimination bursts.
// Everything is pooled (no allocation during play) and additive-blended (a cheap "bloom" look).
import * as THREE from "three";

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.3, "rgba(255,255,255,0.55)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = glowTexture();
const UP = new THREE.Vector3(0, 1, 0);

interface Beam { core: THREE.Mesh; glow: THREE.Mesh; life: number; max: number }
interface Flash { s: THREE.Sprite; life: number; max: number; size: number }

export class Fx {
  readonly group = new THREE.Group();
  private beams: Beam[] = [];
  private flashes: Flash[] = [];
  private light: THREE.PointLight | null;
  private lightLife = 0;
  // sparks
  private sparkN: number;
  private sparkPos: Float32Array; private sparkVel: Float32Array; private sparkCol: Float32Array; private sparkBase: Float32Array;
  private sparkLife: Float32Array; private sparkMax: Float32Array;
  private sparkGeo: THREE.BufferGeometry;
  private nextSpark = 0;

  constructor(low: boolean) {
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < 24; i++) {
      const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const glow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.visible = glow.visible = false;
      core.frustumCulled = glow.frustumCulled = false;
      this.group.add(core, glow);
      this.beams.push({ core, glow, life: 0, max: 1 });
    }
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ s, life: 0, max: 1, size: 1 });
    }
    // one shared flash light (never added/removed, so no shader recompiles)
    this.light = low ? null : new THREE.PointLight("#ffffff", 0, 9, 2);
    if (this.light) this.group.add(this.light);
    this.sparkN = low ? 300 : 700;
    this.sparkPos = new Float32Array(this.sparkN * 3).fill(-999);
    this.sparkVel = new Float32Array(this.sparkN * 3);
    this.sparkCol = new Float32Array(this.sparkN * 3);
    this.sparkBase = new Float32Array(this.sparkN * 3);
    this.sparkLife = new Float32Array(this.sparkN);
    this.sparkMax = new Float32Array(this.sparkN).fill(1);
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute("color", new THREE.BufferAttribute(this.sparkCol, 3));
    const pts = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({ size: 0.07, map: GLOW, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  private pulses: { m: THREE.Mesh; ring: THREE.Mesh; life: number; r: number }[] = [];
  /** An expanding scan pulse (sphere shell + floor ring) out to radius r. */
  pulse(p: THREE.Vector3, color: THREE.Color, r: number): void {
    let x = this.pulses.find((q) => q.life <= 0);
    if (!x) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, wireframe: true }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      this.group.add(m, ring);
      x = { m, ring, life: 0, r };
      this.pulses.push(x);
    }
    (x.m.material as THREE.MeshBasicMaterial).color.copy(color);
    (x.ring.material as THREE.MeshBasicMaterial).color.copy(color);
    x.m.position.copy(p); x.ring.position.set(p.x, 0.05, p.z);
    x.life = 0.7; x.r = r;
    x.m.visible = x.ring.visible = true;
  }

  /** A laser beam from `a` to `b` in a colour. */
  beam(a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color, width = 1): void {
    const beam = this.beams.find((x) => x.life <= 0) ?? this.beams[0];
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return;
    d.divideScalar(len);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
    for (const [m, w] of [[beam.core, 0.012 * width], [beam.glow, 0.05 * width]] as const) {
      m.position.copy(a);
      m.quaternion.copy(q);
      m.scale.set(w, len, w);
      m.visible = true;
    }
    (beam.core.material as THREE.MeshBasicMaterial).color.copy(color).lerp(WHITE, 0.6);
    (beam.glow.material as THREE.MeshBasicMaterial).color.copy(color);
    beam.life = beam.max = 0.11;
  }

  flash(p: THREE.Vector3, color: THREE.Color, size: number, life: number, light = 0): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.s.position.copy(p);
    f.s.material.color.copy(color);
    f.size = size; f.life = f.max = life;
    f.s.visible = true;
    if (light > 0 && this.light) {
      this.light.position.copy(p);
      this.light.color.copy(color);
      this.light.intensity = light;
      this.lightLife = 0.06;
    }
  }

  sparks(p: THREE.Vector3, color: THREE.Color, n: number, speed: number, life = 0.45): void {
    for (let k = 0; k < n; k++) {
      const i = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % this.sparkN;
      this.sparkPos.set([p.x, p.y, p.z], i * 3);
      const th = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.sparkVel.set([Math.cos(th) * r * s, Math.abs(u) * s + 1.2, Math.sin(th) * r * s], i * 3);
      const c = color.clone().lerp(WHITE, Math.random() * 0.5);
      this.sparkBase.set([c.r, c.g, c.b], i * 3);
      this.sparkLife[i] = this.sparkMax[i] = life * (0.6 + Math.random() * 0.6);
    }
  }

  update(dt: number): void {
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = Math.max(0, b.life / b.max);
      (b.core.material as THREE.MeshBasicMaterial).opacity = k;
      (b.glow.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
      b.glow.scale.x = b.glow.scale.z = b.core.scale.x * 4.2 * (1.6 - 0.6 * k);
      if (b.life <= 0) b.core.visible = b.glow.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.s.material.opacity = k;
      f.s.scale.setScalar(f.size * (0.6 + 0.4 * k));
      if (f.life <= 0) f.s.visible = false;
    }
    for (const q of this.pulses) {
      if (q.life <= 0) continue;
      q.life -= dt;
      const k = 1 - Math.max(0, q.life) / 0.7;
      const rr = 0.5 + k * q.r;
      q.m.scale.setScalar(rr); q.ring.scale.setScalar(rr);
      (q.m.material as THREE.MeshBasicMaterial).opacity = 0.25 * (1 - k);
      (q.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (q.life <= 0) q.m.visible = q.ring.visible = false;
    }
    if (this.light && this.lightLife > 0) {
      this.lightLife -= dt;
      if (this.lightLife <= 0) this.light.intensity = 0;
    }
    for (let i = 0; i < this.sparkN; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      const j = i * 3;
      this.sparkVel[j + 1] -= 14 * dt;
      this.sparkPos[j] += this.sparkVel[j] * dt;
      this.sparkPos[j + 1] += this.sparkVel[j + 1] * dt;
      this.sparkPos[j + 2] += this.sparkVel[j + 2] * dt;
      if (this.sparkPos[j + 1] < 0.02) { this.sparkPos[j + 1] = 0.02; this.sparkVel[j + 1] *= -0.35; this.sparkVel[j] *= 0.6; this.sparkVel[j + 2] *= 0.6; }
      const k = Math.max(0, this.sparkLife[i] / this.sparkMax[i]);
      this.sparkCol[j] = this.sparkBase[j] * k; this.sparkCol[j + 1] = this.sparkBase[j + 1] * k; this.sparkCol[j + 2] = this.sparkBase[j + 2] * k;
      if (this.sparkLife[i] <= 0) this.sparkPos[j + 1] = -999;
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.color.needsUpdate = true;
  }
}

const WHITE = new THREE.Color("#ffffff");
