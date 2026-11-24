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
