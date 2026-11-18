// The three.js stage shared by the game and the capture page: renderer, camera, scene and graphics level.
import * as THREE from "three";

export type Graphics = "normal" | "low";
/** How the map is drawn: the greybox blockout, or the finished look. */
export type Look = "greybox" | "final";

export interface StageOptions { graphics: Graphics; width?: number; height?: number; preserve?: boolean }

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly graphics: Graphics;
  private fixedSize: { w: number; h: number } | null;

  constructor(canvas: HTMLCanvasElement, opts: StageOptions) {
    this.graphics = opts.graphics;
    const low = opts.graphics === "low";
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.preserve });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = !low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.fixedSize = opts.width && opts.height ? { w: opts.width, h: opts.height } : null;
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 900);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.resize();
    if (!this.fixedSize) window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = this.fixedSize?.w ?? window.innerWidth, h = this.fixedSize?.h ?? window.innerHeight;
    // capped pixel ratio: sharp enough, never the 3x of a phone or a 5K screen
    const pr = this.fixedSize ? 1 : Math.min(window.devicePixelRatio || 1, this.graphics === "low" ? 1 : 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, !this.fixedSize);
    this.camera.aspect = w / h;
    // keep about the same horizontal view on tall (phone) screens
    this.camera.fov = w / h < 1 ? 85 : 72;
    this.camera.updateProjectionMatrix();
  }

  /** A fresh, empty scene (between matches). Frees the old scene's GPU memory. */
  reset(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    this.scene = new THREE.Scene();
    this.scene.add(this.camera);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
