import "server-only";

// What the server is doing for a paper right now, step by step, so the page can show real progress while a big
// paper opens. In memory, per server process (on AWS: a small DynamoDB row per paper).

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

export function step(id: string, key: StepKey, state: StepState, detail?: string) {
  const p = get(id);
  const s = p.steps.find((x) => x.key === key)!;
  if (state === "active" && s.state !== "active") s.startedAt = Date.now();
  if ((state === "done" || state === "error") && s.startedAt) s.ms = Date.now() - s.startedAt;
  s.state = state;
  if (detail !== undefined) s.detail = detail;
  p.updatedAt = Date.now();
}

export function fail(id: string, message: string) {
  const p = get(id);
  p.error = message;
  for (const s of p.steps) if (s.state === "active") s.state = "error";
  p.updatedAt = Date.now();
}

export function progressOf(id: string): Progress | null {
  return all.get(id) ?? null;
}

export function clearProgress(id: string) {
  all.delete(id);
}

export const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
