// Small procedural textures drawn on canvases (no image downloads). Greyscale where possible, so one
// texture serves many colours through the material colour.
import * as THREE from "three";

let seed = 1234567;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1, srgb = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

function speckle(g: CanvasRenderingContext2D, s: number, n: number, a: number, light = false): void {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${rnd() * a})`;
    const r = 0.5 + rnd() * 2.2;
    g.fillRect(rnd() * s, rnd() * s, r, r);
  }
}

/** Packed dirt and sand with pebbles and faint tyre tracks. */
export const sandTex = () => cached("sand", () => canvasTex(512, (g, s) => {
  g.fillStyle = "#c9b48a"; g.fillRect(0, 0, s, s);
  g.filter = "blur(18px)";
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${150 + rnd() * 40},${125 + rnd() * 30},${85 + rnd() * 25},0.16)`;
    g.beginPath(); g.arc(rnd() * s, rnd() * s, 30 + rnd() * 70, 0, Math.PI * 2); g.fill();
  }
  g.filter = "none";
  speckle(g, s, 5000, 0.18); speckle(g, s, 1500, 0.25, true);
  g.strokeStyle = "rgba(90,70,40,0.10)"; g.lineWidth = 7;
  for (const x of [s * 0.3, s * 0.36]) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 40, s * 0.4, x - 30, s * 0.7, x + 10, s); g.stroke(); }
}));

/** Concrete with stains. Greyscale. */
export const concreteTex = () => cached("concrete", () => canvasTex(256, (g, s) => {
  g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, s, s);
  speckle(g, s, 3000, 0.12);
  for (let i = 0; i < 8; i++) {
    const x = rnd() * s;
    const gr = g.createLinearGradient(x, 0, x, s);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.10)");
    g.fillStyle = gr; g.fillRect(x, 0, 6 + rnd() * 20, s);
  }
  g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, 0, 2, s); // panel seams
}));

/** Corrugated steel (vertical ridges), greyscale, with rust streaks. */
export const corrugatedTex = () => cached("corrugated", () => canvasTex(256, (g, s) => {
  for (let x = 0; x < s; x++) {
    const v = 200 + Math.round(45 * Math.sin((x / s) * Math.PI * 2 * 16));
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, s);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(90,50,20,${0.05 + rnd() * 0.12})`;
    g.fillRect(rnd() * s, rnd() * s * 0.3, 2 + rnd() * 4, s * (0.2 + rnd() * 0.6));
  }
  speckle(g, s, 800, 0.15);
}));

/** Wooden planks (horizontal), greyscale-ish warm. */
export const planksTex = () => cached("planks", () => canvasTex(256, (g, s) => {
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const v = 175 + rnd() * 40;
    g.fillStyle = `rgb(${v},${v * 0.92},${v * 0.82})`; g.fillRect(0, (r * s) / rows, s, s / rows);
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, (r * s) / rows, s, 2);
    for (let k = 0; k < 10; k++) { g.fillStyle = "rgba(60,40,20,0.12)"; g.fillRect(0, (r * s) / rows + rnd() * (s / rows), s, 1); }
  }
  speckle(g, s, 600, 0.2);
}));

/** Painted metal panels with seams and rivets (spaceship walls). Greyscale. */
export const panelTex = () => cached("panel", () => canvasTex(256, (g, s) => {
  g.fillStyle = "#e6e8ec"; g.fillRect(0, 0, s, s);
  speckle(g, s, 700, 0.06);
  g.strokeStyle = "rgba(0,0,0,0.28)"; g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
  g.beginPath(); g.moveTo(0, s * 0.62); g.lineTo(s, s * 0.62); g.stroke();
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (const [x, y] of [[8, 8], [s - 10, 8], [8, s - 10], [s - 10, s - 10], [8, s * 0.62 - 8], [s - 10, s * 0.62 - 8]]) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "rgba(0,0,0,0.06)"; g.fillRect(s * 0.1, s * 0.15, s * 0.8, s * 0.35);
}));

/** Diamond-plate / grating floor tile. Greyscale. */
export const floorPlateTex = () => cached("floorplate", () => canvasTex(256, (g, s) => {
  g.fillStyle = "#9da3ad"; g.fillRect(0, 0, s, s);
  g.fillStyle = "rgba(255,255,255,0.18)";
  for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) {
    g.save(); g.translate(x + 4, y + 4); g.rotate(Math.PI / 4); g.fillRect(-4, -1.2, 8, 2.4); g.restore();
  }
  g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
  speckle(g, s, 500, 0.12);
}));

/** Black-and-yellow hazard stripes. */
export const hazardTex = () => cached("hazard", () => canvasTex(128, (g, s) => {
  g.fillStyle = "#f2b81c"; g.fillRect(0, 0, s, s);
  g.fillStyle = "#1e1f22";
  for (let i = -s; i < s * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - s, s); g.lineTo(i - s, s); g.fill(); }
}));

/** A cargo crate face: frame and a stencilled stripe. Greyscale (tinted by material). */
export const crateTex = () => cached("crate", () => canvasTex(256, (g, s) => {
  g.fillStyle = "#e9e9e9"; g.fillRect(0, 0, s, s);
  g.fillStyle = "#9a9a9a"; g.fillRect(0, 0, s, 18); g.fillRect(0, s - 18, s, 18); g.fillRect(0, 0, 18, s); g.fillRect(s - 18, 0, 18, s);
  g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 2; g.strokeRect(18, 18, s - 36, s - 36);
  g.fillStyle = "rgba(0,0,0,0.6)"; g.font = "bold 34px sans-serif"; g.textAlign = "center"; g.fillText("Z-07", s / 2, s / 2 + 12);
  speckle(g, s, 600, 0.12);
}));

/** Wooden supply crate (army base). */
export const woodCrateTex = () => cached("woodcrate", () => canvasTex(256, (g, s) => {
  g.fillStyle = "#b98a52"; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 5; i++) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, (i * s) / 5, s, 2); }
  g.fillStyle = "#8a6232"; g.fillRect(0, 0, s, 22); g.fillRect(0, s - 22, s, 22); g.fillRect(0, 0, 22, s); g.fillRect(s - 22, 0, 22, s);
  g.strokeStyle = "#8a6232"; g.lineWidth = 20; g.beginPath(); g.moveTo(22, 22); g.lineTo(s - 22, s - 22); g.stroke();
  g.fillStyle = "rgba(40,30,15,0.7)"; g.font = "bold 26px sans-serif"; g.textAlign = "center"; g.fillText("SUPPLY", s / 2, s / 2 - 30);
  speckle(g, s, 800, 0.18);
}));

/** Sky dome gradient + soft sun glow, drawn on a tall canvas (equirect-ish vertical gradient). */
export function skyGradient(top: string, mid: string, horizon: string): THREE.CanvasTexture {
  return canvasTex(256, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, top); gr.addColorStop(0.42, mid); gr.addColorStop(0.5, horizon); gr.addColorStop(1, horizon);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}

/** A planet: banded, lit from one side. */
export const planetTex = () => cached("planet", () => canvasTex(512, (g, s) => {
  const bands = ["#d98a5b", "#e9b07a", "#c46a4a", "#efc89a", "#b85a3e", "#e7a56c"];
  for (let y = 0; y < s; y += 4) {
    const k = Math.floor((y / s) * 18 + Math.sin(y * 0.05) * 1.5);
    g.fillStyle = bands[((k % bands.length) + bands.length) % bands.length]; g.fillRect(0, y, s, 4);
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,240,220,${rnd() * 0.12})`; g.fillRect(0, rnd() * s, s, 1 + rnd() * 3); }
}, 1));
