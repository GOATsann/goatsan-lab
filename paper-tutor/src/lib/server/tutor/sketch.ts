import "server-only";

// A small drawing the tutor writes itself when no icon fits ("a rod-shaped bacterium with flagella").
// It is never used as written: the SVG is parsed, and a new one is built from a short whitelist of shapes and
// attributes with checked values. No scripts, styles, links, text, images or external references can survive.

const MAX_CHARS = 5000;
const MAX_ELEMENTS = 80;
const SHAPES = new Set(["g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const NUM = /^-?\d*\.?\d+(e-?\d+)?$/i;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-\s e]+$/;
const POINTS = /^[0-9.,\-\s e]+$/;
const TRANSFORM = /^((translate|rotate|scale)\(\s*-?[\d.]+(\s*[,\s]\s*-?[\d.]+){0,2}\s*\)\s*)+$/;

const ATTRS: Record<string, RegExp> = {
  d: PATH,
  cx: NUM, cy: NUM, r: NUM, rx: NUM, ry: NUM, x: NUM, y: NUM, width: NUM, height: NUM,
  x1: NUM, y1: NUM, x2: NUM, y2: NUM,
  points: POINTS,
  "stroke-width": NUM,
  opacity: NUM,
  "fill-opacity": NUM,
  transform: TRANSFORM,
  "stroke-linecap": /^(round|butt|square)$/,
  "stroke-linejoin": /^(round|miter|bevel)$/,
  "stroke-dasharray": /^[\d.\s,]+$/,
};
// Colours come from the board's theme: currentColor (the ink) or none.
const PAINT = /^(none|currentColor)$/;

export function cleanSketch(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_CHARS) return null;
  const src = raw.replace(/<!--[\s\S]*?-->/g, "");
  const tags = [...src.matchAll(/<\s*(\/?)\s*([a-zA-Z]+)([^>]*?)(\/?)\s*>/g)];
  if (!tags.length || tags[0][2].toLowerCase() !== "svg") return null;
  const view = tags[0][3].match(/viewBox\s*=\s*["']\s*([\d.\-\s]+)\s*["']/);
  const vb = view?.[1].trim().split(/\s+/).map(Number);
  const viewBox = vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 ? vb.join(" ") : "0 0 100 100";
  // Anything between tags other than whitespace (text, entities) is refused.
  if (src.replace(/<[^>]*>/g, "").trim()) return null;

  let out = "";
  let count = 0;
  const open: string[] = [];
  for (const t of tags.slice(1)) {
    const closing = t[1] === "/";
    const name = t[2].toLowerCase();
    if (name === "svg") {
      if (closing) break;
      return null;
    }
    if (!SHAPES.has(name)) return null;
    if (closing) {
      if (open.pop() !== name) return null;
      if (name === "g") out += "</g>";
      continue;
    }
    if (++count > MAX_ELEMENTS) return null;
    let attrs = "";
    for (const a of t[3].matchAll(/([a-zA-Z-]+)\s*=\s*["']([^"']*)["']/g)) {
      const key = a[1];
      const value = a[2].trim();
      if ((key === "fill" || key === "stroke") && PAINT.test(value)) attrs += ` ${key}="${value}"`;
      else if (ATTRS[key]?.test(value) && value.length < 1500) attrs += ` ${key}="${value}"`;
    }
    const selfClosing = t[4] === "/";
    if (name === "g") {
      out += selfClosing ? `<g${attrs}/>` : `<g${attrs}>`;
    } else {
      out += `<${name}${attrs}/>`;
    }
    if (!selfClosing) open.push(name);
  }
  while (open.length) if (open.pop() === "g") out += "</g>";
  if (!count) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${out}</svg>`;
}
