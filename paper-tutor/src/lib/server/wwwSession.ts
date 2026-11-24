// Login option "www": this app holds no WorkOS keys. It asks the main site who is signed in, forwarding the
// browser's cookies (the shared `wos-session` cookie is scoped to theonlygoatsan.com, so it arrives here too).
// The main site may refresh the session while answering; its Set-Cookie headers must go back to the browser,
// or the rotated refresh token would be lost and the person signed out.
// No server-only import: tests load this file directly.

export type WwwUser = { id: string; email: string; name: string | null };
export type Lookup = { user: WwwUser | null; setCookies: string[]; ok: boolean };

export const WWW_ME_URL = "https://www.theonlygoatsan.com/api/me";

export async function lookupWwwUser(
  cookie: string | null,
  opts: { url?: string; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<Lookup> {
  // Only the session cookie matters to www; without one there is nobody to look up.
  if (!cookie || !/(^|;\s*)wos-session=/.test(cookie)) return { user: null, setCookies: [], ok: true };
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(opts.url ?? WWW_ME_URL, {
      headers: { cookie, accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
    });
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (!res.ok) return { user: null, setCookies, ok: false };
    const body = (await res.json()) as { user?: Partial<WwwUser> | null };
    const u = body?.user;
    const user =
      u && typeof u.id === "string" && typeof u.email === "string"
        ? { id: u.id, email: u.email, name: typeof u.name === "string" ? u.name : null }
        : null;
    return { user, setCookies, ok: true };
  } catch {
    return { user: null, setCookies: [], ok: false }; // timeout or network: nobody, this time
  }
}

// ---- per-process cache: one www round trip per session per 30 s, not one per API call (progress polls!) ----
// Keyed on a SHA-256 of the session cookie's value (never the value itself). Only answers www actually gave are
// kept; failures and timeouts are asked again next time. A refreshed cookie arrives with the fresh answer.
type Entry = { user: WwwUser | null; at: number };
const g = globalThis as unknown as { __wwwUserCache?: Map<string, Entry> };
const cache = (g.__wwwUserCache ??= new Map());
const MAX_ENTRIES = 2000;

async function sessionHash(cookie: string | null): Promise<string | null> {
  const v = cookie ? /(?:^|;\s*)wos-session=([^;]+)/.exec(cookie)?.[1] : null;
  if (!v) return null;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Buffer.from(d).toString("hex");
}

export async function lookupWwwUserCached(
  cookie: string | null,
  opts: { url?: string; timeoutMs?: number; fetch?: typeof fetch; ttlMs?: number; now?: () => number } = {},
): Promise<Lookup & { cached: boolean }> {
  const now = opts.now ?? Date.now;
  const key = await sessionHash(cookie);
  if (!key) return { user: null, setCookies: [], ok: true, cached: false };
  const hit = cache.get(key);
  if (hit && now() - hit.at < (opts.ttlMs ?? 30_000)) return { user: hit.user, setCookies: [], ok: true, cached: true };
  const r = await lookupWwwUser(cookie, opts);
  if (r.ok) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { user: r.user, at: now() });
  } else {
    cache.delete(key);
  }
  return { ...r, cached: false };
}

export function clearWwwUserCache() {
  cache.clear();
}

// API calls that never need to know who is asking: public lists and search, and reads of arXiv papers (only
// uploads are private). Everything else, and anything that writes, gets the lookup.
export function needsUser(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return true;
  if (/^\/api\/(trending|search|browse|icons)(\/|$)/.test(pathname)) return false;
  const paper = /^\/api\/papers\/([^/]+)/.exec(pathname);
  if (paper) return paper[1].startsWith("up_");
  return true;
}
