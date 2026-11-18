// Character select preview: the chosen character turning slowly, aiming, and every few seconds its Special
// Move with effects that make the move obvious (its name is in the text panel next to it):
//   Dash    = a quick dash across the plinth with speed lines and an afterimage trail
//   Bulwark = the frontal energy shield
//   Echo    = an expanding scan ring with a radar sweep
//   Wisp    = a shimmer, then near-invisible, then back
// The rigged model when it is loaded (character.ts), else the stand-in robot with its accessory.
import * as THREE from "three";
import { CHARACTERS } from "../core/characters";
import { hasCharacterModel, loadCharacterModels, makeRobot } from "./character";
import { restPose, type RobotView } from "./robot";

const SPECIAL_EVERY = 5; // seconds between Special Moves in the preview
const FIRST_AT = 1.2; // first Special Move this long after the character is picked
const N_GHOSTS = 3;

export class CharPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 360 / 420, 0.1, 20);
  private model: RobotView | null = null;
  private ghosts: RobotView[] = [];
  private shown = { character: -1, color: "", rigged: false };
  private t = 0;
  private spin = 0;
  private last = performance.now();
  // effects
  private lines = new THREE.Group();
  private ring: THREE.Mesh;
  private shell: THREE.Mesh;
  private sweep: THREE.Mesh;
  running = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(360, 420, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight("#d9e6ff", "#30343d", 1.4));
    const key = new THREE.DirectionalLight("#fff1dc", 2.4);
    key.position.set(2, 3, 3);
    const rim = new THREE.DirectionalLight("#8fb8ff", 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(key, rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25 }));
    disc.rotation.x = -Math.PI / 2;
    this.scene.add(disc);
    // Dash: speed lines (thin additive streaks)
    const lineMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.5 + (i % 3) * 0.25, 0.018), lineMat);
      l.position.set(0, 0.35 + i * 0.2, (i % 2 ? 0.15 : -0.15));
      this.lines.add(l);
    }
    this.lines.visible = false;
    this.scene.add(this.lines);
    // Echo: a floor ring, a faint shell and a radar sweep
    const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } as const;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#9cff6e", ...add }));
    this.ring.position.y = 0.02;
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14), new THREE.MeshBasicMaterial({ color: "#9cff6e", wireframe: true, ...add }));
    this.shell.position.y = 0.9;
    this.sweep = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32, 0, 0.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#9cff6e", ...add }));
    this.sweep.position.y = 0.025;
    for (const m of [this.ring, this.shell, this.sweep]) { m.visible = false; this.scene.add(m); }
    this.camera.position.set(0, 1.25, 4.6);
    this.camera.lookAt(0, 0.95, 0);
    // the rigged characters arrive after the menu opens: swap the preview over when they do
    loadCharacterModels().then(() => { if (this.shown.character >= 0 && !this.shown.rigged) this.show(this.shown.character, this.shown.color); });
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (!this.running || !this.model) return;
      this.t += dt;
      this.frame(dt);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    const m = this.model!;
    const ch = CHARACTERS[this.shown.character];
    const k = this.t - FIRST_AT;
    const age = k >= 0 ? k % SPECIAL_EVERY : Infinity; // seconds into the current Special Move
    const p = restPose();
    p.t = this.t;
    p.specialAge = age;
    // defaults
    m.root.position.set(0, 0, 0);
    this.lines.visible = false;
    for (const g of this.ghosts) g.root.visible = false;
    this.ring.visible = this.shell.visible = this.sweep.visible = false;
    let turning = true;

    switch (ch.ability) {
      case "shield":
        p.shield = age < 2;
        break;
      case "dash": {
        // side-on, a quick burst across the plinth, a short hold, then a walk back
        if (age < 1.4) {
          turning = false;
          m.root.rotation.y = -Math.PI / 2; // facing +x, the way it dashes
          const x = (a: number) => (a < 0 ? -0.45 : a < 0.16 ? -0.45 + 1.0 * (a / 0.16) : a < 0.7 ? 0.55 : 0.55 - 1.0 * Math.min(1, (a - 0.7) / 0.7));
          m.root.position.x = x(age);
          p.speed = age < 0.16 ? 17 : age > 0.7 ? 2.5 : 0;
          p.fwd = age < 0.16 ? 17 : age > 0.7 ? -2.5 : 0;
          // afterimages trail the burst
          const trail = age < 0.45;
          this.ghosts.forEach((g, i) => {
            g.root.visible = trail;
            if (!trail) return;
            g.root.rotation.y = -Math.PI / 2;
            g.root.position.x = x(age - 0.045 * (i + 1));
            const gp = restPose();
            gp.t = this.t; gp.specialAge = age; gp.speed = p.speed; gp.fwd = p.fwd;
            gp.visibility = (0.38 - i * 0.11) * (1 - Math.max(0, age - 0.2) / 0.25);
            g.pose(gp);
          });
          // speed lines behind it
          if (age < 0.4) {
            this.lines.visible = true;
            this.lines.position.x = m.root.position.x - 0.55;
            const mat = (this.lines.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
            mat.opacity = 0.75 * (1 - age / 0.4);
            this.lines.children.forEach((l, i) => { l.position.x = -((age * 6 + i * 0.37) % 0.9); });
          }
        }
        break;
      }
      case "scan": {
        if (age < 1.6) {
          const s = 0.3 + 2.4 * Math.min(1, age / 1.3);
          const fade = 1 - Math.min(1, age / 1.6);
          this.ring.visible = this.shell.visible = this.sweep.visible = true;
          this.ring.scale.setScalar(s);
          (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
          this.shell.scale.setScalar(s * 0.7);
          (this.shell.material as THREE.MeshBasicMaterial).opacity = 0.18 * fade;
          this.sweep.rotation.y = -age * 7;
          (this.sweep.material as THREE.MeshBasicMaterial).opacity = 0.45 * fade;
        }
        break;
      }
      case "cloak": {
        // shimmer, fade to near-invisible, hold, then fade back in
        if (age < 0.35) p.visibility = 0.55 + 0.45 * Math.abs(Math.sin(age * 40));
        else if (age < 0.6) p.visibility = 0.55 - (age - 0.35) / 0.25 * 0.48;
        else if (age < 2.6) p.visibility = 0.07 + 0.04 * Math.sin(age * 9);
        else if (age < 3.0) p.visibility = 0.07 + (age - 2.6) / 0.4 * 0.93;
        p.visibility = Math.min(1, p.visibility);
        break;
      }
    }
    if (turning) {
      this.spin += dt * 0.6;
      m.root.rotation.y = Math.PI + 0.6 + this.spin;
    }
    m.pose(p);
  }

  show(character: number, color: string): void {
    if (this.model) this.scene.remove(this.model.root);
    for (const g of this.ghosts) this.scene.remove(g.root);
    this.ghosts = [];
    // the character in its own colours
    this.model = makeRobot(color, false, character, true);
    this.shown = { character, color, rigged: hasCharacterModel(character) };
    this.t = 0;
    this.scene.add(this.model.root);
    const ch = CHARACTERS[character];
    if (ch.ability === "dash") {
      for (let i = 0; i < N_GHOSTS; i++) {
        const g = makeRobot(color, false, character, true);
        g.root.visible = false;
        this.scene.add(g.root);
        this.ghosts.push(g);
      }
    }
    const mat = (this.lines.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.color.set(ch.accent);
    for (const m of [this.ring, this.shell, this.sweep]) (m.material as THREE.MeshBasicMaterial).color.set(ch.accent);
  }
}
