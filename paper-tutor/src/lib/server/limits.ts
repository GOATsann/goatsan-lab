import "server-only";
import { getStore } from "./store";

// Per user, per UTC day. Locally the counters are files in the store; on AWS this becomes the DynamoDB
// conditional increment keyed `userId#date#kind` (plan, section 4).
export const DAILY_LIMITS = { paper: 3, upload: 5, deepdive: 10, chat: 50 } as const;
export type LimitKind = keyof typeof DAILY_LIMITS;

export class LimitError extends Error {
  status = 429;
}

const key = (userId: string, kind: LimitKind) =>
  `limits/${new Date().toISOString().slice(0, 10)}/${userId.replace(/[^A-Za-z0-9_-]/g, "")}_${kind}.json`;

// Count one use, or throw when today's limit is reached. Dev stub user: unlimited.
export async function useLimit(userId: string, kind: LimitKind): Promise<void> {
  if (userId === "user_dev_local") return;
  const store = getStore();
  const k = key(userId, kind);
  const n = (await store.getJSON<{ n: number }>(k))?.n ?? 0;
  if (n >= DAILY_LIMITS[kind]) throw new LimitError(`You've reached today's limit (${DAILY_LIMITS[kind]}). It resets at midnight UTC.`);
  await store.putJSON(k, { n: n + 1 });
}
