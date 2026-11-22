"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { BOARD_H, BOARD_W, type ArrowStep, type BoxStep, type DrawStep, type EquationStep, type FigureStep, type Ink, type GroupStep, type IconStep, type SketchStep, type PlotStep, type StepsStep, type TextStep, type TitleStep } from "@/lib/scenes/types";
import type { StepTiming } from "@/lib/player/engine";
import { renderRich, renderTex } from "./math";
import { ICONS } from "./Icon";
import { isIconName } from "@/lib/scenes/icons";
import { arrowPath, estimateRect } from "@/lib/scenes/layout";

// Draws one moment of a scene. Every element is placed in board units (1600 x 900) inside a "world" that the
// camera scales and moves. Each element gets a progress p (0..1) from the clock and draws itself up to p.

export type Rect = { x: number; y: number; w: number; h: number };
type Rects = MutableRefObject<Map<string, Rect>>;
type Cam = { cx: number; cy: number; zoom: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DEFAULT_CAM: Cam = { cx: BOARD_W / 2, cy: BOARD_H / 2, zoom: 1 };
const lerpCam = (a: Cam, b: Cam, t: number): Cam => ({
  cx: a.cx + (b.cx - a.cx) * t,
  cy: a.cy + (b.cy - a.cy) * t,
  zoom: a.zoom + (b.zoom - a.zoom) * t,
});

type Placed = { st: DrawStep; key: string; p: number; tm?: StepTiming; time: number };

export type BoardProps = {
  steps: DrawStep[]; // the current scene
  timings: StepTiming[];
  time: number;
  base: DrawStep[]; // finished drawing kept from earlier scenes (keep: true)
  fading: DrawStep[]; // the previous scene, fading out during the wipe
  fade: number; // 1 -> 0
  prevCamera: DrawStep[]; // camera steps that led to where the previous scene ended
  figureSrc: (fig: string) => string | null;
  sceneKey: string;
};

export function Board(props: BoardProps) {
  const { steps, timings, time, base, fading, fade, figureSrc, sceneKey } = props;
  const rects = useRef(new Map<string, Rect>());
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const current: Placed[] = steps.map((st, i) => {
    const tm = timings[i];
    return { st, tm, time, key: `${sceneKey}-${i}`, p: tm ? clamp01((time - tm.start) / tm.dur) : 0 };
  });
  const kept: Placed[] = base.map((st, i) => ({ st, time: Infinity, key: `base-${i}`, p: 1 }));
  const old: Placed[] = fading.map((st, i) => ({ st, time: Infinity, key: `old-${i}`, p: 1 }));

  // Erasing and highlighting act on other elements.
  const live = [...kept, ...current];
  const erased = new Map<string, number>();
  const highlights = new Map<string, { term: string; p: number; note?: string; ink?: Ink }[]>();
  for (const e of live) {
    if (e.st.t === "erase" && e.p > 0) erased.set(e.st.target, easeOut(e.p));
    if (e.st.t === "highlight") {
      const list = highlights.get(e.st.eq) ?? [];
      list.push({ term: e.st.term, p: easeOut(e.p), note: e.st.note, ink: e.st.ink });
      highlights.set(e.st.eq, list);
    }
  }
  const oldHighlights = new Map<string, { term: string; p: number; note?: string; ink?: Ink }[]>();
  for (const e of old) {
    if (e.st.t === "highlight") {
      const list = oldHighlights.get(e.st.eq) ?? [];
      list.push({ term: e.st.term, p: 1, note: e.st.note, ink: e.st.ink });
      oldHighlights.set(e.st.eq, list);
    }
  }

  // Camera: from where the previous scene left it, back to the full board, then this scene's moves.
  const target = (st: DrawStep): Cam => {
    if (st.t !== "camera") return DEFAULT_CAM;
    const zoom = st.zoom ?? (st.focus ? 1.4 : 1);
    let cx = st.x ?? BOARD_W / 2;
    let cy = st.y ?? BOARD_H / 2;
    if (st.focus) {
      const r = rects.current.get(st.focus);
      if (r) {
        cx = r.x + r.w / 2;
        cy = r.y + r.h / 2;
      }
    }
    if (zoom >= 1) {
      const hw = BOARD_W / 2 / zoom;
      const hh = BOARD_H / 2 / zoom;
      cx = Math.min(BOARD_W - hw, Math.max(hw, cx));
      cy = Math.min(BOARD_H - hh, Math.max(hh, cy));
    } else {
      cx = BOARD_W / 2;
      cy = BOARD_H / 2;
    }
    return { cx, cy, zoom };
  };
  let cam = DEFAULT_CAM;
  for (const st of props.prevCamera) cam = target(st);
  cam = lerpCam(cam, DEFAULT_CAM, easeInOut(clamp01(time / 0.7)));
  for (const e of current) if (e.st.t === "camera" && e.p > 0) cam = lerpCam(cam, target(e.st), easeInOut(e.p));

  const s = size.w / BOARD_W;
  const world: CSSProperties = {
    transform: `translate(${size.w / 2}px, ${size.h / 2}px) scale(${s * cam.zoom}) translate(${-cam.cx}px, ${-cam.cy}px)`,
  };

  return (
    <div className="board" ref={stage}>
      <div className="board-bg" aria-hidden />
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="chalk" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" />
        </filter>
      </svg>
      {size.w > 0 ? (
        <div className="world" style={world}>
          {old.length > 0 && fade > 0 ? (
            <div className="layer" style={{ opacity: fade }}>
              {old.map((e) => (
                <Element key={e.key} e={e} rects={rects} figureSrc={figureSrc} erased={0} highlights={oldHighlights} />
              ))}
            </div>
          ) : null}
          <div className="layer">
            {live.map((e) => (
              <Element
                key={e.key}
                e={e}
                rects={rects}
                figureSrc={figureSrc}
                erased={e.st.id ? (erased.get(e.st.id) ?? 0) : 0}
                highlights={highlights}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ElementProps = {
  e: Placed;
  rects: Rects;
  figureSrc: (fig: string) => string | null;
  erased: number;
  highlights: Map<string, { term: string; p: number; note?: string; ink?: Ink }[]>;
};

function Element({ e, rects, figureSrc, erased, highlights }: ElementProps) {
  const { st, p } = e;
  if (st.t === "camera" || st.t === "erase" || st.t === "highlight") return null;
  if (erased >= 1) return null;
  const style: CSSProperties | undefined = erased > 0 ? { opacity: 1 - erased } : undefined;
  const hidden = p <= 0;
  switch (st.t) {
    case "title":
      return <Title st={st} p={p} rects={rects} style={style} hidden={hidden} />;
    case "text":
      return <Text st={st} p={p} rects={rects} style={style} hidden={hidden} />;
    case "box":
      return <Box st={st} p={p} rects={rects} style={style} hidden={hidden} />;
    case "arrow":
      return hidden ? null : <Arrow st={st} p={p} rects={rects} style={style} />;
    case "equation":
      return <Equation st={st} p={p} rects={rects} style={style} hidden={hidden} marks={highlights.get(st.id ?? "") ?? []} />;
    case "figure":
      return <Figure st={st} p={p} rects={rects} style={style} hidden={hidden} src={figureSrc(st.fig)} />;
    case "plot":
      return <Plot st={st} p={p} rects={rects} style={style} hidden={hidden} />;
    case "steps":
      return <Steps st={st} e={e} rects={rects} style={style} />;
    case "icon":
      return <IconEl st={st} p={p} rects={rects} style={style} hidden={hidden} />;
    case "group":
      return <Group st={st} p={p} rects={rects} style={style} hidden={hidden} />;
    case "sketch":
      return <SketchEl st={st} p={p} rects={rects} style={style} hidden={hidden} />;
  }
}

const inkClass = (ink?: Ink) => `ink-${ink ?? "ink"}`;
const writeOn = (p: number): CSSProperties => ({ clipPath: `inset(-20% ${((1 - easeOut(p)) * 100).toFixed(2)}% -20% -4%)` });

// Measure an element's box in board units and remember it by id (for arrows, camera and highlights).
function useMeasure(id: string | undefined, rects: Rects, center: "x" | "xy" | null) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !id) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = el.offsetLeft;
      let y = el.offsetTop;
      if (center === "x" || center === "xy") x -= w / 2;
      if (center === "xy") y -= h / 2;
      rects.current.set(id, { x, y, w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, rects, center]);
  return ref;
}

type Common = { p: number; rects: Rects; style?: CSSProperties; hidden?: boolean };

function Title({ st, p, rects, style, hidden }: Common & { st: TitleStep }) {
  const ref = useMeasure(st.id, rects, "x");
  const subP = clamp01((p - 0.55) / 0.45);
  return (
    <div
      ref={ref}
      className={`el el-title ${hidden ? "is-hidden" : ""}`}
      style={{ left: st.x ?? BOARD_W / 2, top: st.y ?? 320, fontSize: st.size ?? 88, ...style }}
    >
      <div className="title-main" style={writeOn(Math.min(1, p / 0.7))}>
        {st.text}
      </div>
      {st.sub ? (
        <div className="title-sub ink-muted" style={{ opacity: subP, transform: `translateY(${(1 - subP) * 10}px)` }}>
          {st.sub}
        </div>
      ) : null}
      <svg className="title-rule" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden>
        <line x1="0" y1="2" x2={100 * easeOut(clamp01((p - 0.3) / 0.7))} y2="2" />
      </svg>
    </div>
  );
}

function Text({ st, p, rects, style, hidden }: Common & { st: TextStep }) {
  const center = st.align === "center";
  const ref = useMeasure(st.id, rects, center ? "x" : null);
  return (
    <div
      ref={ref}
      className={`el el-text ${inkClass(st.ink)} ${center ? "is-center" : ""} ${hidden ? "is-hidden" : ""}`}
      style={{ left: st.x, top: st.y, fontSize: st.size ?? 40, width: st.w, ...writeOn(p), ...style }}
      dangerouslySetInnerHTML={{ __html: renderRich(st.text) }}
    />
  );
}

function Box({ st, p, rects, style, hidden }: Common & { st: BoxStep }) {
  if (st.id) rects.current.set(st.id, { x: st.x, y: st.y, w: st.w, h: st.h });
  const shape = st.shape ?? "rect";
  const r = shape === "pill" ? st.h / 2 : shape === "circle" ? Math.min(st.w, st.h) / 2 : 14;
  const draw = easeOut(clamp01(p / 0.8));
  const fill = clamp01((p - 0.35) / 0.65);
  return (
    <div className={`el el-box ${inkClass(st.ink)} ${hidden ? "is-hidden" : ""}`} style={{ left: st.x, top: st.y, width: st.w, height: st.h, ...style }}>
      <svg className="box-svg" viewBox={`0 0 ${st.w} ${st.h}`} aria-hidden>
        <rect className="box-fill" x="3" y="3" width={st.w - 6} height={st.h - 6} rx={r} style={{ opacity: fill }} />
        <rect
          className="box-line"
          x="3"
          y="3"
          width={st.w - 6}
          height={st.h - 6}
          rx={r}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - draw}
        />
      </svg>
      {st.text ? (
        <div className="box-label" style={{ opacity: fill, fontSize: st.size ?? 36 }} dangerouslySetInnerHTML={{ __html: renderRich(st.text) }} />
      ) : null}
    </div>
  );
}

function Arrow({ st, p, rects, style }: Common & { st: ArrowStep }) {
  const resolve = (end: ArrowStep["from"]) =>
    Array.isArray(end) ? { x: end[0], y: end[1], w: 0, h: 0 } : (rects.current.get(end) ?? null);
  const a = resolve(st.from);
  const b = resolve(st.to);
  if (!a || !b) return null;
  const bend = st.bend ?? 0;
  const { s: s0, c: ctrl, e: e0 } = arrowPath(a, b, bend);
  const d = `M ${s0.x} ${s0.y} Q ${ctrl.x} ${ctrl.y} ${e0.x} ${e0.y}`;
  const draw = easeOut(p);
  // Arrow head along the curve's end tangent.
  const tx = e0.x - ctrl.x;
  const ty = e0.y - ctrl.y;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const w = st.weight ?? 1;
  const hs = 18 + 6 * (w - 1);
  const head = `M ${e0.x - ux * hs - uy * hs * 0.6} ${e0.y - uy * hs + ux * hs * 0.6} L ${e0.x} ${e0.y} L ${e0.x - ux * hs + uy * hs * 0.6} ${e0.y - uy * hs - ux * hs * 0.6}`;
  const labelAt = { x: 0.25 * s0.x + 0.5 * ctrl.x + 0.25 * e0.x, y: 0.25 * s0.y + 0.5 * ctrl.y + 0.25 * e0.y };
  return (
    <svg className={`el el-arrow ${inkClass(st.ink)}`} width={BOARD_W} height={BOARD_H} viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} style={style} aria-hidden>
      <path className="arrow-line" d={d} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} style={{ strokeWidth: `calc(var(--stroke) * ${w})` }} />
      <path className="arrow-head" d={head} style={{ opacity: clamp01((p - 0.8) / 0.2), strokeWidth: `calc(var(--stroke) * ${Math.max(1, w * 0.8)})` }} />
      {st.label ? (
        <text className="arrow-label" x={labelAt.x} y={labelAt.y - (bend >= 0 ? 22 : -42)} textAnchor="middle" style={{ opacity: clamp01((p - 0.6) / 0.4) }}>
          {st.label}
        </text>
      ) : null}
    </svg>
  );
}

function Equation({ st, p, rects, style, hidden, marks }: Common & { st: EquationStep; marks: { term: string; p: number; note?: string; ink?: Ink }[] }) {
  const ref = useMeasure(st.id, rects, "xy");
  const body = useRef<HTMLDivElement>(null);
  const [terms, setTerms] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});

  // Where each \term sits inside the equation (in its own units), for the highlight notes.
  useLayoutEffect(() => {
    const host = ref.current;
    const el = body.current;
    if (!host || !el) return;
    const measure = () => {
      const hb = host.getBoundingClientRect();
      const k = hb.width / (host.offsetWidth || 1);
      const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
      el.querySelectorAll<HTMLElement>(".term").forEach((t) => {
        const name = [...t.classList].find((c) => c.startsWith("term-"))?.slice(5);
        if (!name) return;
        const r = t.getBoundingClientRect();
        out[name] = { x: (r.left - hb.left) / k, y: (r.top - hb.top) / k, w: r.width / k, h: r.height / k };
      });
      setTerms(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [st.tex, ref]);

  // Paint the marker on each highlighted term.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>(".term").forEach((t) => {
      const name = [...t.classList].find((c) => c.startsWith("term-"))?.slice(5);
      const m = marks.find((x) => x.term === name);
      t.style.setProperty("--hl", String(m ? m.p : 0));
      t.dataset.ink = m?.ink ?? "accent";
    });
  });

  const notes = marks.filter((m) => m.note && terms[m.term]);
  return (
    <div
      ref={ref}
      className={`el el-eq ${hidden ? "is-hidden" : ""}`}
      style={{ left: st.x, top: st.y, fontSize: st.size ?? 64, ...style }}
    >
      <div ref={body} style={writeOn(p)} dangerouslySetInnerHTML={{ __html: renderTex(st.tex, true) }} />
      {notes.map((m, i) => {
        const t = terms[m.term];
        const cx = t.x + t.w / 2;
        const bottom = t.y + t.h;
        const eqW = ref.current?.offsetWidth ?? 0;
        const noteTop = (ref.current?.offsetHeight ?? 0) + 40 + i * 64;
        // Keep the note under its term but inside the equation's width (it is centred on the board).
        const noteW = (m.note?.length ?? 0) * 15;
        const noteLeft = Math.max(Math.min(0, eqW - noteW), Math.min(cx - noteW / 2, eqW - noteW));
        return (
          <div key={m.term} className={`eq-note ink-${m.ink ?? "accent"}`} style={{ opacity: m.p }}>
            <svg className="eq-note-line" style={{ left: 0, top: 0 }} width="1" height="1" aria-hidden>
              <line x1={cx} y1={bottom + 6} x2={cx} y2={bottom + 6 + (noteTop - bottom - 10) * m.p} />
            </svg>
            <div className="eq-note-text" style={{ left: noteLeft, top: noteTop, width: noteW }}>
              {m.note}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Clicking a figure on the board opens it large (the page decides how).
export const FigureClick = createContext<((fig: string, caption?: string) => void) | null>(null);

function Figure({ st, p, rects, style, hidden, src }: Common & { st: FigureStep; src: string | null }) {
  const ref = useMeasure(st.id, rects, null);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const open = useContext(FigureClick);
  const e = easeOut(p);
  const c = st.crop;
  const img =
    src && !failed ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={st.caption ?? st.fig}
        onError={() => setFailed(true)}
        onLoad={(ev) => setNatural({ w: ev.currentTarget.naturalWidth, h: ev.currentTarget.naturalHeight })}
        style={
          c
            ? { position: "absolute", width: `${100 / (c[2] - c[0])}%`, maxWidth: "none", left: `${(-c[0] / (c[2] - c[0])) * 100}%`, top: `${(-c[1] / (c[3] - c[1])) * 100}%` }
            : { clipPath: `inset(0 0 ${(1 - e) * 100}% 0)` }
        }
      />
    ) : null;
  return (
    <div
      ref={ref}
      className={`el el-figure ${hidden ? "is-hidden" : ""} ${open ? "is-clickable" : ""}`}
      style={{ left: st.x, top: st.y, width: st.w, opacity: Math.min(1, e * 1.6), transform: `translateY(${(1 - e) * 18}px) rotate(var(--fig-tilt))`, ...style }}
      onClick={open ? () => open(st.fig, st.caption) : undefined}
      title={open ? "Open the figure" : undefined}
    >
      <div className="figure-card">
        {!img ? (
          <div className="figure-missing">This figure isn&apos;t available.</div>
        ) : c ? (
          <div
            className="figure-crop"
            style={{
              aspectRatio: natural ? `${natural.w * (c[2] - c[0])} / ${natural.h * (c[3] - c[1])}` : "4 / 3",
              clipPath: `inset(0 0 ${(1 - e) * 100}% 0)`,
            }}
          >
            {img}
          </div>
        ) : (
          img
        )}
      </div>
      {st.caption ? <div className="figure-caption">{st.caption}</div> : null}
    </div>
  );
}

function niceMax(v: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function Plot({ st, p, rects, style, hidden }: Common & { st: PlotStep }) {
  if (st.id) rects.current.set(st.id, { x: st.x, y: st.y, w: st.w, h: st.h });
  const m = { l: 86, r: 16, t: 24, b: 96 };
  const iw = st.w - m.l - m.r;
  const ih = st.h - m.t - m.b;
  const lo = st.yMin ?? 0;
  const hiRaw = Math.max(...st.values);
  const hi = lo + niceMax((hiRaw - lo) * 1.08);
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  const axes = easeOut(clamp01(p / 0.2));
  const n = st.values.length;
  const seg = 0.38;
  const barP = (i: number) => easeOut(clamp01((p - 0.15 - (i * (0.85 - seg)) / Math.max(1, n - 1)) / seg));
  const slot = iw / n;
  const bw = Math.min(110, slot * 0.62);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : String(Math.round(v * 100) / 100));
  const linePts = st.values.map((v, i) => `${m.l + slot * (i + 0.5)},${y(v)}`).join(" ");
  return (
    <div className={`el el-plot ${hidden ? "is-hidden" : ""}`} style={{ left: st.x, top: st.y, width: st.w, height: st.h, ...style }}>
      <svg viewBox={`0 0 ${st.w} ${st.h}`} width={st.w} height={st.h} aria-hidden>
        <g style={{ opacity: axes }}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="plot-grid" x1={m.l} x2={m.l + iw * axes} y1={y(t)} y2={y(t)} />
              <text className="plot-tick" x={m.l - 14} y={y(t) + 8} textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          <line className="plot-axis" x1={m.l} x2={m.l} y1={m.t + ih} y2={m.t + ih - ih * axes} />
          <line className="plot-axis" x1={m.l} x2={m.l + iw * axes} y1={m.t + ih} y2={m.t + ih} />
          {st.ylabel ? (
            <text className="plot-ylabel" transform={`translate(22 ${m.t + ih / 2}) rotate(-90)`} textAnchor="middle">
              {st.ylabel}
            </text>
          ) : null}
        </g>
        {st.kind === "bar"
          ? st.values.map((v, i) => {
              const bp = barP(i);
              const top = y(lo + (v - lo) * bp);
              const cx = m.l + slot * (i + 0.5);
              const words = st.labels[i]?.split(" ") ?? [];
              const lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : words;
              const on = i === st.highlight;
              return (
                <g key={i} className={on ? "bar is-on" : "bar"}>
                  <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(0, m.t + ih - top)} rx={5} />
                  <text className="plot-value" x={cx} y={top - 14} textAnchor="middle" style={{ opacity: clamp01((bp - 0.8) / 0.2) }}>
                    {fmt(v)}
                  </text>
                  {lines.map((l, k) => (
                    <text key={k} className="plot-label" x={cx} y={m.t + ih + 38 + k * 30} textAnchor="middle" style={{ opacity: Math.min(axes, clamp01(bp * 3)) }}>
                      {l}
                    </text>
                  ))}
                </g>
              );
            })
          : (
            <g>
              <polyline className="plot-line" points={linePts} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - easeOut(clamp01((p - 0.15) / 0.85))} />
              {st.values.map((v, i) => (
                <g key={i} style={{ opacity: barP(i) }} className={i === st.highlight ? "dot is-on" : "dot"}>
                  <circle cx={m.l + slot * (i + 0.5)} cy={y(v)} r={8} />
                  <text className="plot-label" x={m.l + slot * (i + 0.5)} y={m.t + ih + 38} textAnchor="middle">
                    {st.labels[i]}
                  </text>
                </g>
              ))}
            </g>
          )}
      </svg>
    </div>
  );
}

function Steps({ st, e, rects, style }: { st: StepsStep; e: Placed; rects: Rects; style?: CSSProperties }) {
  const ref = useMeasure(st.id, rects, null);
  const items = e.tm?.items ?? st.items.map(() => -Infinity);
  const dur = e.tm?.dur ?? 0.7;
  const anyShown = items.some((s) => e.time >= s);
  return (
    <ol ref={ref as unknown as React.Ref<HTMLOListElement>} className={`el el-steps ${anyShown ? "" : "is-hidden"}`} style={{ left: st.x, top: st.y, width: st.w, fontSize: st.size ?? 40, ...style }}>
      {st.items.map((item, i) => {
        const ip = e.time === Infinity ? 1 : clamp01((e.time - items[i]) / dur);
        return (
          <li key={i} className="step" style={{ opacity: ip > 0 ? 1 : 0 }}>
            <span className="step-num" style={{ transform: `scale(${easeOut(clamp01(ip / 0.5))})` }}>
              {i + 1}
            </span>
            <span className="step-text" style={writeOn(clamp01((ip - 0.15) / 0.85))} dangerouslySetInnerHTML={{ __html: renderRich(item) }} />
          </li>
        );
      })}
    </ol>
  );
}

// A built-in icon (Lucide) or an Iconify icon from our server, both drawn in the element's ink.
function Picture({ name, size }: { name: string; size: number }) {
  if (isIconName(name)) {
    const Svg = ICONS[name];
    return <Svg width={size} height={size} strokeWidth={1.6} aria-hidden />;
  }
  const [prefix, icon] = name.split(":");
  const url = `url(/api/icons/${prefix}/${icon}.svg)`;
  return <span className="iconify-pic" style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url }} aria-hidden />;
}

function SketchEl({ st, p, rects, style, hidden }: Common & { st: SketchStep }) {
  const size = st.size ?? 180;
  if (st.id) rects.current.set(st.id, { x: st.x - size / 2, y: st.y - size / 2, w: size, h: size + (st.label ? 50 : 0) });
  const e = easeOut(p);
  return (
    <div className={`el el-icon el-sketch ${inkClass(st.ink)} ${hidden ? "is-hidden" : ""}`} style={{ left: st.x, top: st.y - size / 2, ...style }}>
      <div
        className="icon-art"
        style={{ width: size, height: size, clipPath: `inset(0 ${((1 - e) * 100).toFixed(1)}% 0 0)` }}
        dangerouslySetInnerHTML={{ __html: st.svg }}
      />
      {st.label ? (
        <div className="icon-label" style={{ opacity: clamp01((p - 0.6) / 0.4) }}>
          {st.label}
        </div>
      ) : null}
    </div>
  );
}

function IconEl({ st, p, rects, style, hidden }: Common & { st: IconStep }) {
  const size = st.size ?? 120;
  if (st.id) rects.current.set(st.id, { x: st.x - size / 2, y: st.y - size / 2, w: size, h: size + (st.label ? 50 : 0) });
  const e = easeOut(clamp01(p / 0.7));
  const lp = clamp01((p - 0.5) / 0.5);
  return (
    <div className={`el el-icon ${inkClass(st.ink)} ${hidden ? "is-hidden" : ""}`} style={{ left: st.x, top: st.y - size / 2, ...style }}>
      <div className="icon-art" style={{ width: size, height: size, opacity: Math.min(1, e * 1.4), transform: `scale(${0.6 + 0.4 * e}) rotate(${(1 - e) * -8}deg)` }}>
        <Picture name={st.name} size={size} />
      </div>
      {st.label ? (
        <div className="icon-label" style={{ opacity: lp }}>
          {st.label}
        </div>
      ) : null}
    </div>
  );
}

function Group({ st, p, rects, style, hidden }: Common & { st: GroupStep }) {
  const box = estimateRect(st);
  if (st.id && box) rects.current.set(st.id, box);
  const n = st.items.length;
  return (
    <div className={`el el-group ${hidden ? "is-hidden" : ""}`} style={{ left: st.x, top: st.y, ...style }}>
      {st.items.map((it, i) => {
        const ip = easeOut(clamp01(p * (1 + n * 0.25) - i * 0.25));
        const size = it.size ?? (it.icon ? 100 : 30);
        const pic = it.icon ?? null;
        return (
          <div
            key={i}
            className={`group-item ${inkClass(it.ink)}`}
            style={{ left: it.dx, top: it.dy, opacity: ip, transform: `scale(${0.7 + 0.3 * ip})`, fontSize: pic ? undefined : size }}
          >
            {pic ? <Picture name={pic} size={size} /> : <span dangerouslySetInnerHTML={{ __html: renderRich(it.text ?? "") }} />}
          </div>
        );
      })}
    </div>
  );
}
