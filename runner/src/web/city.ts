// The neon city around the track: buildings with lit windows, signs, street lights and a skyline.
// Pure decoration with its own seeded randomness (from the track seed), so a replay always shows
// the same city. Buildings are recycled: when one passes behind the camera it moves to the far end.
import * as THREE from "three";
import { Rng } from "../core/rng";
import { signTexture, windowsTexture } from "./textures";

const SPAN = 180; // metres of city kept ahead of the camera
const SIGNS: [string, string][] = [
  ["BULSHY.FM", "#ff4fd8"], ["OPEN 24/7", "#4fe3ff"], ["NOODLES", "#ffcf4f"], ["LIGHTS-OUT", "#ff5a5a"],
  ["ARCADE", "#8f7bff"], ["RAMEN", "#ff8a3d"], ["HOTEL", "#4fffa8"], ["COFFEE", "#ffd6a0"], ["24H", "#4fe3ff"],
];

interface Block {
  mesh: THREE.Mesh;
  sign: THREE.Mesh | null;
  side: -1 | 1;
  trackZ: number; // metres along the track where it stands
}

export class City {
  readonly group = new THREE.Group();
  private blocks: Block[] = [];
  private lamps: { obj: THREE.Object3D; trackZ: number }[] = [];
  private lampHeads: THREE.MeshBasicMaterial[] = [];
  private dim = 0;
  private rng: Rng;
  private facades = [windowsTexture(1, true), windowsTexture(2, false), windowsTexture(3, true), windowsTexture(4, false)];
  private signTex = new Map<string, THREE.Texture>();
  private nextZ = { [-1]: -10, [1]: -10 } as Record<number, number>;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed);
    for (const side of [-1, 1] as const) {
      while (this.nextZ[side] < SPAN) this.addBlock(side);
    }
    for (let z = -10; z < SPAN; z += 18) this.addLamp(z);
    this.group.add(skyline(seed));
  }

  /** The chaser drains the city's lights (windows and lamp heads), never the track. 0..1 */
  setDim(f: number): void {
    if (Math.abs(f - this.dim) < 0.02) return;
    this.dim = f;
    for (const b of this.blocks) (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 * (1 - 0.75 * f);
    for (const m of this.lampHeads) m.color.setHex(0xc9a878).multiplyScalar(1 - 0.7 * f);
  }

  /** `trackZ` = how far the runner has gone, in metres. */
  update(trackZ: number): void {
    for (const b of this.blocks) {
      let dz = b.trackZ - trackZ;
      if (dz < -25) {
        this.reshape(b, this.nextZ[b.side]);
        dz = b.trackZ - trackZ;
      }
      b.mesh.position.z = -dz;
      if (b.sign) b.sign.position.z = -dz;
    }
    for (const l of this.lamps) {
      let dz = l.trackZ - trackZ;
      while (dz < -25) {
        l.trackZ += Math.ceil(SPAN / 18 + 2) * 18;
        dz = l.trackZ - trackZ;
      }
      l.obj.position.z = -dz;
    }
  }

  private addBlock(side: -1 | 1): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const b: Block = { mesh, sign: null, side, trackZ: 0 };
    this.group.add(mesh);
    this.blocks.push(b);
    this.reshape(b, this.nextZ[side]);
  }

  private reshape(b: Block, at: number): void {
    const r = this.rng;
    const w = 6 + r.int(6), d = 8 + r.int(10), h = 10 + r.int(36);
    const gap = 1 + r.int(4);
    b.trackZ = at + d / 2;
    this.nextZ[b.side] = at + d + gap;
    b.mesh.scale.set(w, h, d);
    b.mesh.position.set(b.side * (7.5 + w / 2 + r.int(3)), h / 2, 0);
    const f = this.facades[r.int(this.facades.length)];
    const m = b.mesh.material as THREE.MeshStandardMaterial;
    const map = f.map.clone(), em = f.emissive.clone();
    for (const t of [map, em]) {
      t.repeat.set(Math.max(1, Math.round(d / 6)), Math.max(1, Math.round(h / 12)));
      t.needsUpdate = true;
    }
    Object.assign(m, { map, emissiveMap: em, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.5 * (1 - 0.75 * this.dim), roughness: 0.85, metalness: 0.1 });
    m.needsUpdate = true;

    if (b.sign) {
      this.group.remove(b.sign);
      b.sign = null;
    }
    if (r.int(100) < 45) {
      const [text, color] = SIGNS[r.int(SIGNS.length)];
      const key = text + color;
      if (!this.signTex.has(key)) this.signTex.set(key, signTexture(text, color));
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 1.25),
        new THREE.MeshBasicMaterial({ map: this.signTex.get(key)!, transparent: true, opacity: 0.82, color: 0xb8b8c8 }),
      );
      sign.position.set(b.mesh.position.x - b.side * (w / 2 + 0.05), 5 + r.int(Math.max(1, h - 10)), 0);
      sign.rotation.y = -b.side * Math.PI / 2;
      this.group.add(sign);
      b.sign = sign;
    }
  }

  private addLamp(trackZ: number): void {
    const obj = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 6), new THREE.MeshStandardMaterial({ color: 0x1c2033 }));
    for (const side of [-1, 1]) {
      const p = pole.clone();
      p.position.set(side * 5.6, 3, 0);
      const headMat = new THREE.MeshBasicMaterial({ color: 0xc9a878 });
      this.lampHeads.push(headMat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.3), headMat);
      head.position.set(side * 5.2, 6, 0);
      obj.add(p, head);
    }
    this.group.add(obj);
    this.lamps.push({ obj, trackZ });
  }
}

/** Far silhouettes against the sky, with a few lit windows. */
function skyline(seed: number): THREE.Object3D {
  const r = new Rng(seed ^ 0xc17c);
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a2350, fog: false }); // dark blue, not black: only the chaser is black
  for (let i = 0; i < 40; i++) {
    const w = 8 + r.int(16), h = 25 + r.int(70);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(-160 + i * 8 + r.int(6), h / 2 - 5, -230 - r.int(30));
    g.add(m);
  }
  return g;
}
