// "The Blackout": the chaser. A small, pale sheet ghost with dark eyes that floats behind the runner
// after a stumble and drifts back when you run clean. No glow: a dark outline keeps its silhouette
// readable against the night. Visual only: the rules live in the core (chaserTicks, chaserGap,
// stumbleCount), and it never covers the track or the runner.
import * as THREE from "three";
import * as C from "../core/config";
import type { Game } from "../core/game";

export class Ghost {
  readonly object = new THREE.Group();
  private sheet: THREE.Group;
  private t = 0;

  constructor() {
    // classic sheet ghost: rounded top, straight sides, wavy bottom edge (a lathe profile)
    const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 1.05)];
    for (let i = 1; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.sin(a) * 0.42, 0.63 + Math.cos(a) * 0.42));
    }
    pts.push(new THREE.Vector2(0.46, 0.05));
    const geo = new THREE.LatheGeometry(pts.reverse(), 36); // bottom-to-top: faces point outward
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.1) {
        const ang = Math.atan2(pos.getZ(i), pos.getX(i));
        pos.setY(i, 0.05 - 0.1 * (0.5 + 0.5 * Math.sin(ang * 7)));
      }
    }
    geo.computeVertexNormals();

    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xdfe3f5, roughness: 0.85 }));
    // outline: the same shape a bit larger, back faces only, in near-black (an "inverted hull")
    const outline = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0a0b18, side: THREE.BackSide }));
    outline.scale.setScalar(1.07);
    outline.position.y = -0.02;
    this.sheet = new THREE.Group();
    this.sheet.add(outline, body);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x15132a });
    for (const x of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), eyeMat);
      eye.scale.set(0.8, 1.2, 0.4);
      eye.position.set(x, 0.74, -0.4);
      this.sheet.add(eye);
    }
    this.object.add(this.sheet);
    this.object.visible = false;
  }

  /** How close the chaser is: 0 (far, gone) .. 1 (right behind you). */
  static closeness(g: Game): number {
    if (g.dead && g.deathCause === "caught") return 1;
    return Math.max(0, Math.min(1, 1 - (g.chaserGap - C.CHASER_CLOSE) / 20000));
  }

  update(g: Game, dt: number): void {
    this.t += dt;
    const near = Ghost.closeness(g);
    this.object.visible = near > 0.05;
    if (!this.object.visible) return;
    // behind the runner and to the side, low in the frame: never in front of the runner or the lanes ahead
    const side = g.x <= 0 ? 1.3 : -1.3;
    const gapM = g.chaserGap / 1000;
    this.object.position.set(g.x / 1000 + side, 0.55 + g.y / 1000 + Math.sin(this.t * 2.6) * 0.1, Math.min(4.6, 2.2 + gapM * 0.3));
    this.sheet.rotation.set(Math.sin(this.t * 1.9) * 0.08, Math.sin(this.t * 1.3) * 0.2, Math.sin(this.t * 2.2) * 0.06);
    this.object.scale.setScalar(0.4 + near * 0.2);
  }
}
