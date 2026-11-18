// Character select preview: the chosen character turning slowly, aiming, with its Special Move every few
// seconds. The rigged model when it is loaded (character.ts), else the stand-in robot with its accessory.
import * as THREE from "three";
import { CHARACTERS } from "../core/characters";
import { hasCharacterModel, loadCharacterModels, makeRobot } from "./character";
import { restPose, type RobotView } from "./robot";

const SPECIAL_EVERY = 5; // seconds between Special Moves in the preview

export class CharPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 360 / 420, 0.1, 20);
  private model: RobotView | null = null;
  private shown = { character: -1, color: "", rigged: false };
  private t = 0;
  private last = performance.now();
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
      this.model.root.rotation.y = Math.PI + 0.6 + this.t * 0.6;
      const p = restPose();
      p.t = this.t;
      // the Special Move: 1.5 s after the character is picked, then every few seconds
      const k = this.t - 1.5;
      p.specialAge = k >= 0 ? k % SPECIAL_EVERY : Infinity;
      if (CHARACTERS[this.shown.character]?.ability === "shield") p.shield = p.specialAge < 2;
      this.model.pose(p);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  show(character: number, color: string): void {
    if (this.model) this.scene.remove(this.model.root);
    // the rigged model keeps its own glow colour here; in a match it takes the slot colour
    this.model = makeRobot(color, false, character, true);
    this.shown = { character, color, rigged: hasCharacterModel(character) };
    this.t = 0;
    this.scene.add(this.model.root);
  }
}
