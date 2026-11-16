// Textures drawn in code (no image files): building windows, hazard stripes, the night sky, neon signs.
import * as THREE from "three";
import { Rng } from "../core/rng";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

const tex = (c: HTMLCanvasElement, repeat = false) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

/** Facade with lit and dark windows; also returned as an emissive map so lit windows glow. */
export function windowsTexture(seed: number, warm: boolean): { map: THREE.Texture; emissive: THREE.Texture } {
  const r = new Rng(seed);
  const [c, x] = canvas(128, 256), [e, ex] = canvas(128, 256);
  x.fillStyle = "#2a3358";
  x.fillRect(0, 0, 128, 256);
  ex.fillStyle = "#000";
  ex.fillRect(0, 0, 128, 256);
  const lit = warm ? ["#ffcf7a", "#ffb35c", "#fff0c2"] : ["#7ad7ff", "#a98bff", "#e2f4ff"];
  for (let y = 8; y < 248; y += 16) {
    for (let col = 6; col < 122; col += 14) {
      const on = r.int(100) < 38;
      x.fillStyle = on ? lit[r.int(lit.length)] : "#1c2340";
      x.fillRect(col, y, 9, 10);
      if (on) {
        ex.fillStyle = x.fillStyle;
        ex.fillRect(col, y, 9, 10);
      }
    }
  }
  return { map: tex(c, true), emissive: tex(e, true) };
}

export function hazardTexture(): THREE.Texture {
  const [c, x] = canvas(128, 32);
  x.fillStyle = "#16141c";
  x.fillRect(0, 0, 128, 32);
  x.fillStyle = "#ffd23f";
  for (let i = -32; i < 160; i += 32) {
    x.beginPath();
    x.moveTo(i, 32);
    x.lineTo(i + 16, 32);
    x.lineTo(i + 32, 0);
    x.lineTo(i + 16, 0);
    x.closePath();
    x.fill();
  }
  return tex(c);
}

export function skyTexture(): THREE.Texture {
  const [c, x] = canvas(16, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  // blue hour: deep blue overhead, violet and warm city glow at the horizon
  g.addColorStop(0, "#0e1a4a");
  g.addColorStop(0.45, "#26368a");
  g.addColorStop(0.75, "#5a4aa8");
  g.addColorStop(0.92, "#a0609e");
  g.addColorStop(1, "#d98a8a");
  x.fillStyle = g;
  x.fillRect(0, 0, 16, 256);
  return tex(c);
}

/** A neon sign: glowing text in a tube colour, on a dark board. */
export function signTexture(text: string, color: string): THREE.Texture {
  const [c, x] = canvas(512, 128);
  x.fillStyle = "rgba(8,8,18,0.85)";
  x.fillRect(0, 0, 512, 128);
  x.strokeStyle = color;
  x.lineWidth = 6;
  x.strokeRect(8, 8, 496, 112);
  x.font = "700 64px system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.shadowColor = color;
  x.shadowBlur = 24;
  x.fillStyle = color;
  x.fillText(text, 256, 68);
  x.shadowBlur = 0;
  x.fillStyle = "#ffffff";
  x.globalAlpha = 0.65;
  x.fillText(text, 256, 68);
  return tex(c);
}

/** Track bed: dark gravel with a subtle grain, tiled along the lanes. */
export function gravelTexture(): THREE.Texture {
  const r = new Rng(99);
  const [c, x] = canvas(128, 128);
  x.fillStyle = "#2b2f44";
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 40 + r.int(30);
    x.fillStyle = `rgb(${v},${v + 2},${v + 10})`;
    x.fillRect(r.int(128), r.int(128), 1 + r.int(2), 1 + r.int(2));
  }
  return tex(c, true);
}

/** A soft round pool of light, for under street lamps (added on top of the ground). */
export function lightPoolTexture(): THREE.Texture {
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,226,170,0.55)");
  g.addColorStop(0.5, "rgba(255,200,140,0.18)");
  g.addColorStop(1, "rgba(255,200,140,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return tex(c);
}
