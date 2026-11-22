import "server-only";
import { getStore } from "./store";

// Per user, per UTC day (plan, section 4). Locally the counters are files in the store; on AWS the same calls
// become a DynamoDB conditional increment keyed `userId#date#kind`. Anything already cached is free and never
// counted: these only run when the AI (or a new upload) actually has to do work.
export const DAILY_LIMITS = { paper: 3, upload: 5, deepdive: 10, chat: 50 } as const;
export type LimitKind = keyof typeof DAILY_LIMITS;

const LABEL: Record<LimitKind, string> = {
  paper: "new papers",
  upload: "uploads",
  deepdive: "deep dives and explanations",
  chat: "chat messages",
};

export class LimitError extends Error {
  status = 429;
}

type Counter = { n: number; ids?: string[] };

const key = (userId: string, kind: LimitKind) =>
  `limits/${new Date().toISOString().slice(0, 10)}/${userId.replace(/[^A-Za-z0-9_-]/g, "")}_${kind}.json`;

// Serialise updates per counter so two requests at once can't both take the last slot.
const g = globalThis as unknown as { __limitLocks?: Map<string, Promise<unknown>> };
const locks = (g.__limitLocks ??= new Map());
function locked<T>(k: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(k) ?? Promise.resolve()).then(job, job);
  locks.set(k, run.catch(() => undefined));
  return run;
}

function limitError(kind: LimitKind) {
  return new LimitError(`You've used today's ${DAILY_LIMITS[kind]} ${LABEL[kind]}. The limit resets at midnight UTC.`);
}

// Count one use, or throw when today's limit is reached.
export async function useLimit(userId: string, kind: LimitKind): Promise<void> {
  const k = key(userId, kind);
  await locked(k, async () => {
    const store = getStore();
    const c = (await store.getJSON<Counter>(k)) ?? { n: 0 };
    if (c.n >= DAILY_LIMITS[kind]) throw limitError(kind);
    await store.putJSON(k, { ...c, n: c.n + 1 });
  });
}

// A "new paper" is counted once per paper per day, however many AI passes it needs (overview + map).
export async function usePaperLimit(userId: string, paperId: string): Promise<void> {
  const k = key(userId, "paper");
  await locked(k, async () => {
    const store = getStore();
    const c = (await store.getJSON<Counter>(k)) ?? { n: 0, ids: [] };
    const ids = c.ids ?? [];
    if (ids.includes(paperId)) return;
    if (c.n >= DAILY_LIMITS.paper) throw limitError("paper");
    await store.putJSON(k, { n: c.n + 1, ids: [...ids, paperId] });
  });
}

export async function usage(userId: string): Promise<Record<LimitKind, { used: number; limit: number }>> {
  const store = getStore();
  const out = {} as Record<LimitKind, { used: number; limit: number }>;
  for (const kind of Object.keys(DAILY_LIMITS) as LimitKind[]) {
    const c = await store.getJSON<Counter>(key(userId, kind));
    out[kind] = { used: c?.n ?? 0, limit: DAILY_LIMITS[kind] };
  }
  return out;
}
