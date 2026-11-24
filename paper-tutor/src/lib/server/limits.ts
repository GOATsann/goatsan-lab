import "server-only";
import { getStore } from "./store";

// Per user, per UTC day (plan, section 4). Locally the counters are files in the store; on AWS they are DynamoDB
// conditional increments. Anything already cached is free and never
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

function limitError(kind: LimitKind) {
  return new LimitError(`You've used today's ${DAILY_LIMITS[kind]} ${LABEL[kind]}. The limit resets at midnight UTC.`);
}

const TWO_DAYS = 2 * 86400; // counters expire on their own (DynamoDB TTL on AWS)

// Count one use, or throw when today's limit is reached. Atomic in the store (a DynamoDB conditional update on
// AWS), so parallel requests on any number of servers can never take more than the limit.
export async function useLimit(userId: string, kind: LimitKind): Promise<void> {
  const r = await getStore().count(key(userId, kind), { max: DAILY_LIMITS[kind], ttlSec: TWO_DAYS });
  if (r === "full") throw limitError(kind);
}

// A "new paper" is counted once per paper per day, however many AI passes it needs (overview + map).
export async function usePaperLimit(userId: string, paperId: string): Promise<void> {
  const r = await getStore().count(key(userId, "paper"), { max: DAILY_LIMITS.paper, member: paperId, ttlSec: TWO_DAYS });
  if (r === "full") throw limitError("paper");
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
