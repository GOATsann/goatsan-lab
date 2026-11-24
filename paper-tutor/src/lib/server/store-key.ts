// The store's interface and key rules, with no server-only imports (so tests can load them).
export type CountResult = "counted" | "already" | "full";

export interface Store {
  getJSON<T>(key: string): Promise<T | null>;
  putJSON(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<void>;
  getBlob(key: string): Promise<Buffer | null>;
  putBlob(key: string, data: Buffer | Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  // Writes the record only if it doesn't exist (or has expired). True if this call created it: a lock.
  createJSON(key: string, value: unknown, opts: { ttlSec: number }): Promise<boolean>;
  // A daily counter: counts one use unless `n` is at `max`. With `member`, each member counts once ("already").
  count(key: string, opts: { max: number; member?: string; ttlSec: number }): Promise<CountResult>;
  // Adds to a number field and returns the new total (spend tracking).
  add(key: string, amount: number, opts: { ttlSec: number }): Promise<number>;
  // Reserves the next time slot for a rate-limited service shared by every instance ("1 request per 3 s").
  // Returns how many ms to wait before calling it.
  reserveSlot(key: string, gapMs: number): Promise<number>;
}

// Keys look like "papers/1706.03762/meta.json". Only these characters reach the file system or AWS.
export function safeKey(key: string): string {
  if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`bad store key: ${key}`);
  }
  return key;
}

