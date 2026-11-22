import type { ThemeName } from "@/lib/types";

// The scene list: what the AI (or a person) writes, and what the whiteboard player draws and voices.
// One scene = one short narration line ("say") plus drawing steps. The board is 1600 x 900 units, origin top-left.
// The drawing tools are few and fixed, so AI output stays reliable.
//
// Timing: a step starts while sentence `s` of the scene's narration is spoken (0-based). Steps without `s` are
// spread evenly over the sentences. Steps in the same sentence start one after another.

export const BOARD_W = 1600;
export const BOARD_H = 900;

export type Ink = "ink" | "accent" | "warn" | "muted" | "good";

type StepBase = {
  id?: string; // name it to point arrows, highlights, the camera or erase at it
  s?: number; // the sentence it starts with
  dur?: number; // seconds the drawing takes (each tool has a sensible default)
};

export type TitleStep = StepBase & { t: "title"; text: string; x?: number; y?: number; size?: number; sub?: string };
export type TextStep = StepBase & {
  t: "text";
  text: string; // may hold inline math as $...$
  x: number;
  y: number;
  w?: number; // wrap width
  size?: number;
  ink?: Ink;
  align?: "left" | "center";
};
export type BoxStep = StepBase & {
  t: "box";
  x: number; // top-left
  y: number;
  w: number;
  h: number;
  text?: string;
  ink?: Ink;
  shape?: "rect" | "pill" | "circle";
  size?: number;
};
export type ArrowStep = StepBase & {
  t: "arrow";
  from: string | [number, number]; // a step id, or a board point
  to: string | [number, number];
  label?: string;
  bend?: number; // -1..1, curves the arrow; 0 = straight
  ink?: Ink;
  weight?: number; // line width multiplier (e.g. attention strength)
};
export type EquationStep = StepBase & {
  t: "equation";
  tex: string; // mark highlightable parts as \term{name}{...}
  x: number; // center
  y: number;
  size?: number;
};
export type HighlightStep = StepBase & {
  t: "highlight";
  eq: string; // id of an equation step
  term: string; // the \term name
  note?: string; // a short note written under the term
  ink?: Ink;
};
export type FigureStep = StepBase & {
  t: "figure";
  fig: string; // "fig1": a figure crop of the scene list's paper
  x: number; // top-left
  y: number;
  w: number;
  caption?: string;
};
export type PlotStep = StepBase & {
  t: "plot";
  kind: "bar" | "line";
  x: number;
  y: number;
  w: number;
  h: number;
  labels: string[];
  values: number[];
  highlight?: number; // index to mark
  ylabel?: string;
  yMin?: number;
};
export type StepsStep = StepBase & {
  t: "steps";
  items: string[];
  x: number;
  y: number;
  w?: number;
  size?: number;
  pace?: "sentence"; // item i appears with sentence s + i (default: one after another)
};
export type CameraStep = StepBase & { t: "camera"; focus?: string; x?: number; y?: number; zoom?: number };
export type EraseStep = StepBase & { t: "erase"; target: string };

export type DrawStep =
  | TitleStep
  | TextStep
  | BoxStep
  | ArrowStep
  | EquationStep
  | HighlightStep
  | FigureStep
  | PlotStep
  | StepsStep
  | CameraStep
  | EraseStep;

export type Scene = {
  say: string;
  draw: DrawStep[];
  keep?: boolean; // keep the previous scene's drawing instead of wiping the board
};

export type SceneList = {
  title: string;
  paper?: string; // arXiv id, for figure crops
  theme?: ThemeName;
  scenes: Scene[];
};

export const DEFAULT_DUR: Record<DrawStep["t"], number> = {
  title: 1.1,
  text: 0.9,
  box: 0.7,
  arrow: 0.6,
  equation: 1.4,
  highlight: 0.6,
  figure: 1.0,
  plot: 1.8,
  steps: 0.7, // per item
  camera: 1.2,
  erase: 0.45,
};

export function stepDuration(step: DrawStep): number {
  if (step.dur) return step.dur;
  if (step.t === "steps") return DEFAULT_DUR.steps * Math.max(1, step.items.length);
  if (step.t === "text") return Math.min(2, DEFAULT_DUR.text + step.text.length * 0.008);
  return DEFAULT_DUR[step.t];
}

// Narration split into sentences: the voice is made, and the drawing is timed, one sentence at a time.
export function splitSentences(say: string): string[] {
  return say
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .filter(Boolean);
}

// Without a voice (muted, or no audio yet), a sentence lasts as long as speaking it would take.
export function estimateSeconds(sentence: string): number {
  const words = sentence.split(/\s+/).filter(Boolean).length;
  return Math.max(1.2, words / 2.6 + 0.2);
}
