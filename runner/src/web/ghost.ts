// "The Blackout": the chaser. A small pale sheet ghost with dark eyes and a dark outline (no glow).
// It hovers behind the runner, a moment late on lane changes, reaching forward with sheet-hands that
// grab as it closes in. At the end of every run it swoops in and circles you while dizzy stars spin.
// Visual only: the rules live in the core (chaserTicks, chaserGap, stumbleCount).
import * as THREE from "three";
import * as C from "../core/config";
import type { Game } from "../core/game";

export class Ghost {
  readonly object = new THREE.Group();
  readonly stars = new THREE.Group(); // dizzy stars over a caught runner
  private sheet = new THREE.Group();
  private hands: THREE.Group[] = [];
  private t = 0;
  private x = 0; // lags behind the runner's lane changes
  private caughtT = -1;
  private from = new THREE.Vector3(); // where the end-of-run swoop starts

  constructor() {
    const geo = sheetGeometry();
    // pale but matte: readable without glowing under the bloom
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8f94ad, roughness: 1 }));
    const outline = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0a0b18, side: THREE.BackSide }));
    outline.scale.setScalar(1.07);
    outline.position.y = -0.02;
    this.sheet.add(outline, body);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x15132a });
    for (const x of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), eyeMat);
      eye.scale.set(0.8, 1.2, 0.4);
      eye.position.set(x, 0.74, -0.4);
      this.sheet.add(eye);
    }
    // sheet-hands: small rounded flaps on short arms, reaching forward (-z)
    const handGeo = new THREE.CapsuleGeometry(0.08, 0.3, 4, 10);
    handGeo.rotateX(Math.PI / 2);
    handGeo.translate(0, 0, -0.2);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const hand = new THREE.Mesh(handGeo, body.material);
      const edge = new THREE.Mesh(handGeo, outline.material);
      edge.scale.setScalar(1.12);
      arm.add(edge, hand);
      arm.position.set(side * 0.36, 0.58, -0.15);
      this.hands.push(arm);
      this.sheet.add(arm);
    }
    this.object.add(this.sheet);
    this.object.visible = false;

    const starMat = new THREE.MeshBasicMaterial({ color: 0xffe35a });
    const starGeo = starGeometry();
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(starGeo, starMat);
      s.userData.phase = (i / 4) * Math.PI * 2;
      this.stars.add(s);
    }
    this.stars.visible = false;
  }

  /** How close the chaser is: 0 (far, gone) .. 1 (right behind you). */
  static closeness(g: Game): number {
    if (g.dead && g.deathCause === "caught") return 1;
    return Math.max(0, Math.min(1, 1 - (g.chaserGap - C.CHASER_CLOSE) / 20000));
  }

  /** camZ = the camera's distance behind the runner (m): the ghost keeps 3 m from the lens. */
  update(g: Game, dt: number, camZ = 6.5): void {
    this.t += dt;
    const rx = g.x / 1000, ry = g.y / 1000;

    if (g.dead) {
      // every run end: the ghost swoops in and circles the runner; dizzy stars spin over the head.
      // It keeps going (slower after two fast loops) for as long as the card is up.
      if (this.caughtT < 0) {
        this.caughtT = 0;
        this.from.copy(this.object.visible ? this.object.position : new THREE.Vector3(rx, 3, camZ + 2));
      }
      this.caughtT += dt;
      const fast = 1.6, wFast = (2 * Math.PI * 2) / fast, wSlow = 1.3;
      const a = Math.PI / 2 + (this.caughtT < fast ? this.caughtT * wFast : fast * wFast + (this.caughtT - fast) * wSlow);
      const orbit = new THREE.Vector3(rx + Math.cos(a) * 1.4, ry + 1.25 + Math.sin(this.t * 3) * 0.1, Math.sin(a) * 1.4);
      const swoop = Math.min(1, this.caughtT / 0.5);
      this.object.position.lerpVectors(this.from, orbit, 1 - (1 - swoop) ** 3);
      this.object.visible = true;
      this.object.scale.setScalar(0.8);
      this.sheet.rotation.set(0, -a - Math.PI / 2, 0);
      this.hands.forEach((h, i) => { h.rotation.x = -0.6 + Math.sin(this.t * 8 + i * Math.PI) * 0.3; });
      this.stars.visible = true;
      this.stars.position.set(rx, ry + 0.75, 0.2);
      this.stars.children.forEach((s) => {
        const p = s.userData.phase + this.t * 4;
        s.position.set(Math.cos(p) * 0.45, Math.sin(this.t * 6 + s.userData.phase) * 0.05, Math.sin(p) * 0.3);
        s.rotation.z = this.t * 5;
      });
      return;
    }
    this.caughtT = -1;
    this.stars.visible = false;

    const near = Ghost.closeness(g);
    this.object.visible = near > 0.05;
    if (!this.object.visible) {
      this.x = rx;
      return;
    }
    // hovering behind the runner, ~1 m off the ground, offset toward the edge of the frame so it
    // never covers the runner or the track ahead; it follows lane changes a moment late
    const side = rx > 0.5 ? -1.2 : 1.2;
    this.x += (rx + side - this.x) * Math.min(1, dt * 4);
    const gapM = g.chaserGap / 1000;
    this.object.position.set(this.x, 1.0 + ry * 0.9 + Math.sin(this.t * 2.2) * 0.12, Math.min(camZ - 3, 1.0 + gapM * 0.25));
    this.object.scale.setScalar(0.45 + near * 0.22);
    // lean in and grab: arms reach further and clutch faster the closer it is
    this.sheet.rotation.set(-0.25 * near, Math.sin(this.t * 1.3) * 0.15 - side * 0.15, Math.sin(this.t * 2.2) * 0.05);
    this.hands.forEach((h, i) => {
      const grab = Math.sin(this.t * (6 + 6 * near) + i * Math.PI);
      h.rotation.x = -0.4 - 0.5 * near + grab * 0.35 * near;
      h.scale.z = 1 + 0.4 * near + grab * 0.15;
    });
  }
}

function sheetGeometry(): THREE.BufferGeometry {
  // classic sheet ghost: rounded top, straight sides, wavy bottom edge (a lathe profile, bottom to top)
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 1.05)];
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * 0.42, 0.63 + Math.cos(a) * 0.42));
  }
  pts.push(new THREE.Vector2(0.46, 0.05));
  const geo = new THREE.LatheGeometry(pts.reverse(), 36);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0.1) pos.setY(i, 0.05 - 0.1 * (0.5 + 0.5 * Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 7)));
  }
  geo.computeVertexNormals();
  return geo;
}

function starGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.05 : 0.12, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
}
