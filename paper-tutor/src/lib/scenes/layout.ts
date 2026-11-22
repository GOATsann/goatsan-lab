import { BOARD_H, BOARD_W, type ArrowStep, type DrawStep, type Scene } from "./types";

// Layout checks for scenes, used on every scene the player gets (hand-written or written by the AI):
// estimate each element's box, nudge anything that overlaps something already on the board into free space,
// and re-route (or drop) arrows that would cut through text. The board itself measures the real boxes when it
// draws; these estimates are deliberately a little generous.

export type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
export type FigureSizes = Record<string, { width: number; height: number }>;

const M = 40; // board margin
const GAP = 12; // space kept between elements

// ---- arrow geometry (shared with the board, so checks and drawing agree) ----

export function edgePoint(r: Rect, toward: Pt, pad: number): Pt {
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const t = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy);
  return { x: c.x + dx * t + (dx / len) * pad, y: c.y + dy * t + (dy / len) * pad };
}

// Where a curved arrow leaves or meets a box: on the side facing the curve, spread along it toward the curve,
// so several arcs from one box don't all start at the same corner.
export function arcAnchor(r: Rect, ctrl: Pt, pad: number): Pt {
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const dx = ctrl.x - c.x;
  const dy = ctrl.y - c.y;
  if (Math.abs(dy) * r.w >= Math.abs(dx) * r.h) {
    const x = c.x + Math.max(-r.w * 0.38, Math.min(r.w * 0.38, dx * 0.3));
    return { x, y: dy < 0 ? r.y - pad : r.y + r.h + pad };
  }
  const y = c.y + Math.max(-r.h * 0.38, Math.min(r.h * 0.38, dy * 0.3));
  return { x: dx < 0 ? r.x - pad : r.x + r.w + pad, y };
}

export function arrowPath(a: Rect, b: Rect, bend: number, pad = 10): { s: Pt; c: Pt; e: Pt } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const dist = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
  const nx = (cb.y - ca.y) / dist;
  const ny = -(cb.x - ca.x) / dist;
  const sign = cb.x >= ca.x ? 1 : -1;
  // Arc height grows with distance, with a floor so short hops still read as arcs.
  const lift = bend * Math.max(dist * 0.55, 220);
  const c = { x: mid.x + nx * lift * sign, y: mid.y + ny * lift * sign };
  const s = a.w ? (bend ? arcAnchor(a, c, pad) : edgePoint(a, cb, pad)) : ca;
  const e = b.w ? (bend ? arcAnchor(b, c, pad) : edgePoint(b, ca, pad)) : cb;
  return { s, c, e };
}

// ---- size estimates ----

const lines = (chars: number, size: number, width: number) => Math.max(1, Math.ceil((chars * size * 0.52) / Math.max(60, width)));
const visibleTex = (tex: string) =>
  tex
    .replace(/\\term\{[^}]*\}/g, "")
    .replace(/\\(mathrm|text|operatorname|mathbf|mathcal|left|right|big|Big)\b/g, "")
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[{}_^\s]/g, "").length;

export function estimateRect(st: DrawStep, figures: FigureSizes = {}): Rect | null {
  switch (st.t) {
    case "title": {
      const size = st.size ?? 88;
      const w = Math.min(1440, st.text.length * size * 0.55);
      const n = lines(st.text.length, size * 1.05, 1440);
      const h = n * size * 1.05 + (st.sub ? size * 0.55 : 0) + size * 0.45;
      const x = (st.x ?? BOARD_W / 2) - w / 2;
      return { x, y: st.y ?? 320, w, h };
    }
    case "text": {
      const size = st.size ?? 40;
      const plain = st.text.replace(/\$[^$]*\$/g, (m) => "x".repeat(Math.ceil(m.length * 0.6)));
      const natural = plain.length * size * 0.52;
      const w = Math.min(natural, st.w ?? natural);
      const h = lines(plain.length, size, st.w ?? natural) * size * 1.25;
      const x = st.align === "center" ? st.x - w / 2 : st.x;
      return { x, y: st.y, w, h };
    }
    case "box":
    case "plot":
      return { x: st.x, y: st.y, w: st.w, h: st.h };
    case "equation": {
      const size = st.size ?? 64;
      const w = Math.min(1500, visibleTex(st.tex) * size * 0.55 + size);
      const h = size * (/\\frac|\\sum|\\int|\\prod/.test(st.tex) ? 2.4 : 1.5);
      return { x: st.x - w / 2, y: st.y - h / 2, w, h };
    }
    case "figure": {
      const f = figures[st.fig];
      const c = st.crop ?? [0, 0, 1, 1];
      const ratio = f ? (f.height * (c[3] - c[1])) / (f.width * (c[2] - c[0])) : 0.75;
      return { x: st.x, y: st.y, w: st.w, h: st.w * ratio + 28 + (st.caption ? 44 : 0) };
    }
    case "steps": {
      const size = st.size ?? 40;
      const w = st.w ?? 1000;
      const h = st.items.reduce((a, it) => a + lines(it.length + 3, size, w) * size * 1.3 + size * 0.6, 0);
      return { x: st.x, y: st.y, w, h };
    }
    case "sketch":
    case "icon": {
      const size = st.size ?? 120;
      const lw = st.label ? Math.max(size, st.label.length * 30 * 0.52) : size;
      return { x: st.x - lw / 2, y: st.y - size / 2, w: lw, h: size + (st.label ? 50 : 0) };
    }
    case "group": {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const it of st.items) {
        const size = it.size ?? (it.icon ? 100 : 30);
        const w = it.icon ? size : (it.text?.length ?? 0) * size * 0.52;
        const h = it.icon ? size : size * 1.25;
        x0 = Math.min(x0, st.x + it.dx);
        y0 = Math.min(y0, st.y + it.dy);
        x1 = Math.max(x1, st.x + it.dx + w);
        y1 = Math.max(y1, st.y + it.dy + h);
      }
      return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
    default:
      return null;
  }
}

const overlap = (a: Rect, b: Rect, gap = 0) =>
  Math.max(0, Math.min(a.x + a.w + gap, b.x + b.w + gap) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h + gap, b.y + b.h + gap) - Math.max(a.y, b.y));

const inside = (r: Rect) => r.x >= M - 1 && r.y >= M - 10 && r.x + r.w <= BOARD_W - M + 1 && r.y + r.h <= BOARD_H - M + 10;

function move(st: DrawStep, dx: number, dy: number): DrawStep {
  if (st.t === "title") return { ...st, x: (st.x ?? BOARD_W / 2) + dx, y: (st.y ?? 320) + dy };
  if ("x" in st && "y" in st && typeof st.x === "number" && typeof st.y === "number") return { ...st, x: st.x + dx, y: st.y + dy } as DrawStep;
  return st;
}

// Points along an arrow, for crossing checks.
function samples(p: { s: Pt; c: Pt; e: Pt }, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * p.s.x + 2 * u * t * p.c.x + t * t * p.e.x, y: u * u * p.s.y + 2 * u * t * p.c.y + t * t * p.e.y });
  }
  return out;
}
const hits = (pts: Pt[], r: Rect, pad = 6) => pts.some((q) => q.x > r.x - pad && q.x < r.x + r.w + pad && q.y > r.y - pad && q.y < r.y + r.h + pad);

// Highlight notes hang under their equation: reserve that space.
function withNotes(st: DrawStep, r: Rect, steps: DrawStep[]): Rect {
  if (st.t !== "equation" || !st.id) return r;
  const notes = steps.filter((s) => s.t === "highlight" && s.eq === st.id && s.note).length;
  return notes ? { ...r, h: r.h + 40 + notes * 64 } : r;
}

export type LayoutResult = { scene: Scene; issues: string[] };

// Check one scene; `base` is what stays on the board from earlier scenes (keep: true).
export function layoutScene(scene: Scene, opts: { base?: DrawStep[]; figures?: FigureSizes } = {}): LayoutResult {
  const issues: string[] = [];
  const figures = opts.figures ?? {};
  const placed: { id?: string; r: Rect; text: boolean }[] = [];
  const byId = new Map<string, Rect>();
  const all = [...(opts.base ?? []), ...scene.draw];
  for (const st of opts.base ?? []) {
    let r: Rect | null = null;
    try {
      r = estimateRect(st, figures);
    } catch {
      continue; // a malformed step from the browser: ignore it
    }
    if (!r) continue;
    const rr = withNotes(st, r, all);
    placed.push({ id: st.id, r: rr, text: true });
    if (st.id) byId.set(st.id, r);
  }

  const out: DrawStep[] = [];
  for (const st0 of scene.draw) {
    let st = st0;
    if (st.t === "arrow") {
      out.push(st); // routed below, once every box is known
      continue;
    }
    const r0 = estimateRect(st, figures);
    if (!r0) {
      out.push(st);
      continue;
    }
    let r = withNotes(st, r0, all);
    const clash = (x: Rect) => placed.some((p) => overlap(x, p.r, GAP) > 40);
    if (clash(r) || !inside(r)) {
      // Try nudges: down, up, right, left, in growing steps; keep the first spot that is free and on the board.
      let best: { dx: number; dy: number } | null = null;
      for (let k = 1; k <= 14 && !best; k++) {
        for (const [ux, uy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1]]) {
          const dx = ux * k * 30;
          const dy = uy * k * 30;
          const t = { ...r, x: r.x + dx, y: r.y + dy };
          if (inside(t) && !clash(t)) {
            best = { dx, dy };
            break;
          }
        }
      }
      if (best) {
        st = move(st, best.dx, best.dy);
        r = { ...r, x: r.x + best.dx, y: r.y + best.dy };
        issues.push(`moved ${st.t}${st.id ? ` "${st.id}"` : ""} by (${best.dx}, ${best.dy})`);
      } else {
        issues.push(`no free space for ${st.t}${st.id ? ` "${st.id}"` : ""}`);
      }
    }
    placed.push({ id: st.id, r, text: st.t !== "box" });
    if (st.id) byId.set(st.id, { ...r0, x: r.x, y: r.y });
    out.push(st);
  }

  // Arrows: must not cut through anything except the two things they join.
  const routed: DrawStep[] = [];
  for (const st of out) {
    if (st.t !== "arrow") {
      routed.push(st);
      continue;
    }
    const end = (v: ArrowStep["from"]): Rect | null => (Array.isArray(v) ? { x: v[0], y: v[1], w: 0, h: 0 } : (byId.get(v) ?? null));
    const a = end(st.from);
    const b = end(st.to);
    if (!a || !b) {
      routed.push(st);
      continue;
    }
    const obstacles = placed.filter((p) => p.r !== a && p.r !== b && !(p.id && (p.id === st.from || p.id === st.to)));
    const clear = (bend: number) => !obstacles.some((o) => hits(samples(arrowPath(a, b, bend)), o.r));
    const want = st.bend ?? 0;
    const tries = [want, ...[0.3, -0.3, 0.5, -0.5, 0.75, -0.75].map((d) => (want === 0 ? d : want + Math.sign(want) * Math.abs(d) * 0.5)), 0];
    const ok = tries.find((b0) => Math.abs(b0) <= 1 && clear(b0));
    if (ok === undefined) {
      issues.push(`dropped arrow ${typeof st.from === "string" ? st.from : "point"} -> ${typeof st.to === "string" ? st.to : "point"} (crosses text)`);
      continue;
    }
    if (ok !== want) issues.push(`re-routed arrow (bend ${want} -> ${ok})`);
    routed.push(ok === want ? st : { ...st, bend: ok });
  }
  return { scene: { ...scene, draw: routed }, issues };
}

// A whole list: each scene is checked against what stays on the board from the scenes before it.
export function layoutScenes(scenes: Scene[], figures?: FigureSizes): { scenes: Scene[]; issues: string[] } {
  const done: Scene[] = [];
  const issues: string[] = [];
  for (const [i, sc] of scenes.entries()) {
    if (sc.pending) {
      done.push(sc);
      continue;
    }
    const base: DrawStep[] = [];
    for (let k = i; k > 0 && scenes[k].keep; k--) base.unshift(...done[k - 1].draw);
    const r = layoutScene(sc, { base, figures });
    done.push(r.scene);
    issues.push(...r.issues.map((m) => `scene ${i + 1}: ${m}`));
  }
  return { scenes: done, issues };
}
