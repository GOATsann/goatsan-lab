import "server-only";
import { createHash } from "node:crypto";
import { getStore } from "./store";

// Cached JSON in the store, with a time to live. `null` ttl = keep forever.
export async function cached<T>(name: string, ttlMs: number | null, make: () => Promise<T>): Promise<T> {
  const key = `cache/${createHash("sha256").update(name).digest("hex").slice(0, 32)}.json`;
  const store = getStore();
  const hit = await store.getJSON<{ at: number; value: T }>(key);
  if (hit && (ttlMs === null || Date.now() - hit.at < ttlMs)) return hit.value;
  const value = await make();
  await store.putJSON(key, { at: Date.now(), value });
  return value;
}
