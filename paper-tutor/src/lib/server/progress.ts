import "server-only";
import { getStore } from "./store";

// What the server is doing for a paper right now, step by step, so the page can show real progress while a big
// paper opens. Kept in memory and written to the store at most every 0.7 s (and on every state change), so a poll
// that lands on any server instance sees it.

export type StepKey = "download" | "pages" | "figures" | "map" | "overview";
export type StepState = "waiting" | "active" | "done" | "error" | "skipped";
export type Step = { key: StepKey; label: string; state: StepState; detail?: string; startedAt?: number; ms?: number };
export type Progress = { steps: Step[]; error?: string; updatedAt: number };

const LABELS: Record<StepKey, string> = {
  download: "Downloading",
  pages: "Reading pages",
  figures: "Finding figures",
  map: "Mapping the paper",
  overview: "Writing the overview",
};
const ORDER: StepKey[] = ["download", "pages", "figures", "map", "overview"];

const g = globalThis as unknown as { __progress?: Map<string, Progress> };
const all = (g.__progress ??= new Map());

function get(id: string): Progress {
  let p = all.get(id);
  if (!p) {
    p = { steps: ORDER.map((key) => ({ key, label: LABELS[key], state: "waiting" as StepState })), updatedAt: Date.now() };
    all.set(id, p);
  }
  return p;
}

const KEY = (id: string) => `progress/${id}.json`;
const lastWrite = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function flush(id: string, now = false) {
  const write = () => {
    timers.delete(id);
    lastWrite.set(id, Date.now());
    const p = all.get(id);
    if (p) void getStore().putJSON(KEY(id), p, { ttlSec: 86400 }).catch(() => undefined);
  };
  const since = Date.now() - (lastWrite.get(id) ?? 0);
  if (now || since > 700) return write();
  if (!timers.has(id)) timers.set(id, setTimeout(write, 700 - since));
}

export function step(id: string, key: StepKey, state: StepState, detail?: string) {
  const p = get(id);
  const s = p.steps.find((x) => x.key === key)!;
  const changed = s.state !== state;
  if (state === "active" && s.state !== "active") s.startedAt = Date.now();
  if ((state === "done" || state === "error") && s.startedAt) s.ms = Date.now() - s.startedAt;
  s.state = state;
  if (detail !== undefined) s.detail = detail;
  p.updatedAt = Date.now();
  flush(id, changed);
}

export function fail(id: string, message: string) {
  const p = get(id);
  p.error = message;
  for (const s of p.steps) if (s.state === "active") s.state = "error";
  p.updatedAt = Date.now();
  flush(id, true);
}

// The freshest of this instance's copy and the stored one.
export async function progressOf(id: string): Promise<Progress | null> {
  const mine = all.get(id) ?? null;
  const stored = await getStore().getJSON<Progress>(KEY(id)).catch(() => null);
  if (!mine) return stored;
  if (!stored) return mine;
  return stored.updatedAt > mine.updatedAt ? stored : mine;
}

export function clearProgress(id: string) {
  all.delete(id);
}

export const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
