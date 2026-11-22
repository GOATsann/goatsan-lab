import "server-only";
import katex from "katex";
import { BOARD_H, BOARD_W, splitSentences, type DrawStep, type Ink, type Scene } from "@/lib/scenes/types";
import type { Figure } from "@/lib/types";
import { isIconName } from "@/lib/scenes/icons";
import { cleanSketch } from "./sketch";
import { ICON_ID } from "../iconify";
import type { GroupItem } from "@/lib/scenes/types";

// Every scene the AI writes passes through here before it reaches a player: unknown fields are dropped, numbers
// are clamped onto the board, references (arrow ends, highlights, figures, camera targets) must point at
// something real, and equations must render. A broken step is dropped; a scene without narration is dropped.

const X0 = 40;
const X1 = BOARD_W - 40;
const Y0 = 30;
const Y1 = BOARD_H - 30;

export type BoardState = {
  ids: Set<string>; // ids drawn on the board right now (this scene, plus earlier ones kept)
  terms: Map<string, Set<string>>; // equation id -> its \term names
};

export function emptyBoard(): BoardState {
  return { ids: new Set(), terms: new Map() };
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : undefined);
const INKS: Ink[] = ["ink", "accent", "warn", "muted", "good"];
const ink = (v: unknown) => (INKS.includes(v as Ink) ? (v as Ink) : undefined);

function texOk(tex: string): boolean {
  try {
    katex.renderToString(tex.replace(/\\term\{([A-Za-z0-9_-]+)\}/g, "\\htmlClass{term term-$1}"), {
      throwOnError: true,
      strict: "ignore",
      trust: (c) => c.command === "\\htmlClass",
    });
    return true;
  } catch {
    return false;
  }
}

// Inline $math$ in text must render too; if it doesn't, show it as plain text.
function richOk(text: string): string {
  return text.replace(/\$([^$]+)\$/g, (m, tex: string) => (texOk(tex) ? m : tex));
}

function step(raw: Record<string, unknown>, nSent: number, figures: Map<string, Figure>, board: BoardState): DrawStep | null {
  const base = {
    id: id(raw.id),
    s: Math.round(num(raw.s, 0, Math.max(0, nSent - 1), 0)),
    ...(raw.dur !== undefined ? { dur: num(raw.dur, 0.3, 4, 1) } : {}),
  };
  switch (raw.t) {
    case "title": {
      const text = str(raw.text, 90);
      if (!text) return null;
      return { ...base, t: "title", text, x: num(raw.x, 400, 1200, 800), y: num(raw.y, Y0, 620, 300), size: num(raw.size, 40, 110, 80), sub: str(raw.sub, 120) || undefined };
    }
    case "text": {
      const text = richOk(str(raw.text, 260));
      if (!text) return null;
      const center = raw.align === "center";
      const size = num(raw.size, 22, 64, 38);
      const x = num(raw.x, center ? 200 : X0, center ? 1400 : X1 - 200, center ? 800 : 100);
      const room = center ? 2 * Math.min(x - X0, X1 - x) : X1 - x;
      const w = Math.min(room, raw.w === undefined ? room : num(raw.w, 160, 1520, room));
      return { ...base, t: "text", text, x, y: num(raw.y, Y0, Y1 - size, 200), w, size, ink: ink(raw.ink), align: center ? "center" : "left" };
    }
    case "box": {
      const w = num(raw.w, 60, 1520, 240);
      const h = num(raw.h, 40, 700, 100);
      const x = num(raw.x, X0, X1 - w, 100);
      const y = num(raw.y, Y0, Y1 - h, 300);
      const shape = raw.shape === "pill" || raw.shape === "circle" ? raw.shape : "rect";
      return { ...base, t: "box", x, y, w, h, text: richOk(str(raw.text, 80)) || undefined, ink: ink(raw.ink), shape, size: num(raw.size, 18, 56, 32) };
    }
    case "arrow": {
      const end = (v: unknown): string | [number, number] | null => {
        if (typeof v === "string") return board.ids.has(v) ? v : null;
        if (Array.isArray(v) && v.length === 2) return [num(v[0], X0, X1, 800), num(v[1], Y0, Y1, 450)];
        return null;
      };
      const from = end(raw.from);
      const to = end(raw.to);
      if (!from || !to) return null;
      return { ...base, t: "arrow", from, to, label: str(raw.label, 40) || undefined, bend: num(raw.bend, -1, 1, 0), ink: ink(raw.ink), weight: num(raw.weight, 0.5, 3, 1) };
    }
    case "equation": {
      const tex = str(raw.tex, 400).replace(/^\$+|\$+$/g, "");
      if (!tex || !texOk(tex)) return null;
      const eqId = base.id ?? `eq${board.terms.size + 1}`;
      board.terms.set(eqId, new Set([...tex.matchAll(/\\term\{([A-Za-z0-9_-]+)\}/g)].map((m) => m[1])));
      return { ...base, id: eqId, t: "equation", tex, x: num(raw.x, 300, 1300, 800), y: num(raw.y, 90, 780, 400), size: num(raw.size, 32, 80, 60) };
    }
    case "highlight": {
      const eq = typeof raw.eq === "string" ? raw.eq : "";
      const term = typeof raw.term === "string" ? raw.term : "";
      if (!board.terms.get(eq)?.has(term)) return null;
      const i = ink(raw.ink);
      return { ...base, t: "highlight", eq, term, note: str(raw.note, 60) || undefined, ink: i === "muted" || i === "ink" ? "accent" : i };
    }
    case "figure": {
      const fig = typeof raw.fig === "string" ? figures.get(raw.fig) : undefined;
      if (!fig) return null;
      let crop: [number, number, number, number] | undefined;
      if (Array.isArray(raw.crop) && raw.crop.length === 4) {
        const [a, b, c, d] = raw.crop.map((v) => num(v, 0, 1, 0));
        if (c - a >= 0.1 && d - b >= 0.1) crop = [a, b, c, d];
      }
      const ratio = (fig.height * (crop ? crop[3] - crop[1] : 1)) / (fig.width * (crop ? crop[2] - crop[0] : 1));
      let x = num(raw.x, X0, X1 - 200, 860);
      let y = num(raw.y, Y0, Y1 - 200, 170);
      let w = num(raw.w, 200, X1 - x, 640);
      // Fit the whole card (padding + caption) on the board: shrink, then move up if needed.
      const extra = 28 + (raw.caption ? 44 : 0);
      if (y + w * ratio + extra > Y1) w = Math.max(200, (Y1 - y - extra) / ratio);
      if (y + w * ratio + extra > Y1) y = Math.max(Y0, Y1 - w * ratio - extra);
      if (x + w > X1) x = X1 - w;
      return { ...base, t: "figure", fig: fig.id, x, y, w, caption: str(raw.caption, 80) || undefined, ...(crop ? { crop } : {}) };
    }
    case "plot": {
      const values = Array.isArray(raw.values) ? raw.values.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
      const labels = Array.isArray(raw.labels) ? raw.labels.map((l) => str(l, 28)) : [];
      if (values.length < 2 || values.length > 10 || labels.length !== values.length) return null;
      const w = num(raw.w, 400, 1500, 900);
      const h = num(raw.h, 300, 700, 520);
      const lo = Math.min(...values);
      const yMin = raw.yMin === undefined ? undefined : Math.min(num(raw.yMin, -1e12, 1e12, 0), lo);
      return {
        ...base,
        t: "plot",
        kind: raw.kind === "line" ? "line" : "bar",
        x: num(raw.x, X0, X1 - w, 100),
        y: num(raw.y, Y0, Y1 - h, 200),
        w,
        h,
        labels,
        values,
        highlight: raw.highlight === undefined ? undefined : Math.round(num(raw.highlight, 0, values.length - 1, 0)),
        ylabel: str(raw.ylabel, 40) || undefined,
        yMin,
      };
    }
    case "steps": {
      const items = Array.isArray(raw.items) ? raw.items.map((i) => richOk(str(i, 100))).filter(Boolean).slice(0, 6) : [];
      if (!items.length) return null;
      const size = num(raw.size, 24, 56, 40);
      const x = num(raw.x, X0, X1 - 300, 100);
      const tall = items.length * size * 1.9;
      const y = Math.max(Y0, Math.min(num(raw.y, Y0, Y1, 200), Y1 - tall));
      return { ...base, t: "steps", items, x, y, w: Math.min(X1 - x, num(raw.w, 300, 1520, X1 - x)), size, pace: raw.pace === "sentence" ? "sentence" : undefined };
    }
    case "icon": {
      // A built-in name, or something to look up on Iconify (resolved after this, in resolvePictures).
      const name = isIconName(raw.name) ? raw.name : undefined;
      const query = name ? undefined : str(raw.query ?? raw.name, 40);
      if (!name && !query) return null;
      const size = num(raw.size, 50, 280, 120);
      return {
        ...base,
        t: "icon",
        name: name ?? `?${query}`,
        x: num(raw.x, X0 + size / 2, X1 - size / 2, 800),
        y: num(raw.y, Y0 + size / 2, Y1 - size / 2 - (raw.label ? 50 : 0), 450),
        size,
        label: str(raw.label, 40) || undefined,
        ink: ink(raw.ink),
      };
    }
    case "sketch": {
      const svg = cleanSketch(raw.svg);
      if (!svg) return null;
      const size = num(raw.size, 60, 400, 180);
      return {
        ...base,
        t: "sketch",
        svg,
        x: num(raw.x, X0 + size / 2, X1 - size / 2, 800),
        y: num(raw.y, Y0 + size / 2, Y1 - size / 2 - (raw.label ? 50 : 0), 450),
        size,
        label: str(raw.label, 40) || undefined,
        ink: ink(raw.ink),
      };
    }
    case "group": {
      const items: GroupItem[] = [];
      for (const it of Array.isArray(raw.items) ? raw.items.slice(0, 8) : []) {
        if (!it || typeof it !== "object") continue;
        const r = it as Record<string, unknown>;
        const icon = isIconName(r.icon) ? r.icon : typeof r.icon === "string" && str(r.icon, 40) ? `?${str(r.icon, 40)}` : undefined;
        const text = icon ? undefined : richOk(str(r.text, 40));
        if (!icon && !text) continue;
        items.push({ icon, text, dx: num(r.dx, -400, 800, 0), dy: num(r.dy, -300, 600, 0), size: num(r.size, icon ? 30 : 20, icon ? 240 : 56, icon ? 100 : 30), ink: ink(r.ink) });
      }
      if (!items.length) return null;
      return { ...base, t: "group", x: num(raw.x, X0, X1 - 100, 200), y: num(raw.y, Y0, Y1 - 100, 300), items };
    }
    case "camera": {
      const focus = typeof raw.focus === "string" && board.ids.has(raw.focus) ? raw.focus : undefined;
      if (typeof raw.focus === "string" && !focus) return null;
      return {
        ...base,
        t: "camera",
        focus,
        x: raw.x === undefined ? undefined : num(raw.x, 0, BOARD_W, 800),
        y: raw.y === undefined ? undefined : num(raw.y, 0, BOARD_H, 450),
        zoom: num(raw.zoom, 1, 2.2, focus ? 1.4 : 1),
      };
    }
    case "erase": {
      return typeof raw.target === "string" && board.ids.has(raw.target) ? { ...base, t: "erase", target: raw.target } : null;
    }
    default:
      return null;
  }
}

// Returns the clean scene (or null), and updates the board state for the next scene.
export function sanitizeScene(raw: unknown, figures: Figure[], board: BoardState, sectionIds?: Set<string>): Scene | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const say = str(r.say, 500).replace(/\$/g, "");
  if (!say) return null;
  const keep = r.keep === true;
  if (!keep) {
    board.ids.clear();
    board.terms.clear();
  }
  const nSent = splitSentences(say).length;
  const figMap = new Map(figures.map((f) => [f.id, f]));
  const draw: DrawStep[] = [];
  const rawSteps = Array.isArray(r.draw) ? r.draw.slice(0, 16) : [];
  for (const rs of rawSteps) {
    if (!rs || typeof rs !== "object") continue;
    const st = step(rs as Record<string, unknown>, nSent, figMap, board);
    if (!st) continue;
    if (st.id) {
      if (board.ids.has(st.id) && st.t !== "equation") st.id = `${st.id}_${draw.length}`;
      board.ids.add(st.id);
    }
    draw.push(st);
  }
  const cite = Array.isArray(r.cite)
    ? r.cite.map((c) => str(c, 80)).filter((c) => c && (!sectionIds || sectionIds.size === 0 || sectionIds.has(c) || !ID.test(c))).slice(0, 3)
    : [];
  return { say, draw, ...(keep ? { keep: true } : {}), ...(cite.length ? { cite } : {}) };
}

// Steps sent by the browser (what is on the board when someone interrupts): only used to know which ids exist.
export function boardFromSteps(steps: unknown): BoardState {
  const b = emptyBoard();
  if (!Array.isArray(steps)) return b;
  for (const s of steps.slice(0, 60)) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const sid = id(r.id);
    if (!sid) continue;
    b.ids.add(sid);
    if (r.t === "equation" && typeof r.tex === "string") {
      b.terms.set(sid, new Set([...r.tex.matchAll(/\\term\{([A-Za-z0-9_-]+)\}/g)].map((m) => m[1])));
    }
  }
  return b;
}

// Icon lookups ("?bacteria") become Iconify ids; icons nothing matched are dropped.
export async function resolvePictures(scene: Scene, find: (q: string) => Promise<string | null>): Promise<Scene> {
  const queries = new Set<string>();
  for (const st of scene.draw) {
    if (st.t === "icon" && st.name.startsWith("?")) queries.add(st.name.slice(1));
    if (st.t === "group") for (const it of st.items) if (it.icon?.startsWith("?")) queries.add(it.icon.slice(1));
  }
  if (!queries.size) return scene;
  const found = new Map<string, string | null>();
  await Promise.all([...queries].map(async (q) => found.set(q, await find(q).catch(() => null))));
  const ok = (v: string | null | undefined): v is string => typeof v === "string" && ICON_ID.test(v);
  const draw: DrawStep[] = [];
  for (const st of scene.draw) {
    if (st.t === "icon" && st.name.startsWith("?")) {
      const id = found.get(st.name.slice(1));
      if (ok(id)) draw.push({ ...st, name: id });
      continue;
    }
    if (st.t === "group") {
      const items = st.items.flatMap((it) => {
        if (!it.icon?.startsWith("?")) return [it];
        const id = found.get(it.icon.slice(1));
        return ok(id) ? [{ ...it, icon: id }] : [];
      });
      if (items.length) draw.push({ ...st, items });
      continue;
    }
    draw.push(st);
  }
  return { ...scene, draw };
}
