import "server-only";

// A short-window rate limit in memory (per server process). Daily product limits live in limits.ts.
const g = globalThis as unknown as { __rate?: Map<string, { n: number; reset: number }> };
const windows = (g.__rate ??= new Map());

export function hitRate(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.reset <= now) {
    w = { n: 0, reset: now + windowMs };
    windows.set(key, w);
  }
  w.n += 1;
  return w.n <= limit;
}
