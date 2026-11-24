import "server-only";
import { headers } from "next/headers";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { lookupWwwUser } from "./wwwSession";

// One login for every theonlygoatsan.com app (WorkOS AuthKit, run by the personal site). This app never
// handles the callback: sign-in starts and ends on www, and the sealed `wos-session` cookie is shared across
// subdomains. Pages are public; server code asks who is signed in only when someone acts.

export type User = { id: string; email: string; name: string | null };

// AUTH_MODE=www: no WorkOS keys here; www says who is signed in (see proxy.ts).
export const wwwAuth = () => process.env.AUTH_MODE === "www";

// Login is on with www mode, or when every WorkOS setting is present.
export function authConfigured(): boolean {
  if (wwwAuth()) return true;
  return Boolean(
    process.env.WORKOS_CLIENT_ID &&
      process.env.WORKOS_API_KEY &&
      (process.env.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32 &&
      process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  );
}

// Dev only: a stub user so actions can be tried without WorkOS. Never in a production build.
export function devUserEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.PAPER_TUTOR_DEV_USER === "1";
}

const DEV_USER: User = { id: "user_dev_local", email: "dev@localhost", name: "Dev" };

// Who is asking, from the session cookie. Never trust anything the browser says about itself.
export async function currentUser(): Promise<User | null> {
  if (devUserEnabled()) return DEV_USER;
  if (!authConfigured()) return null;
  if (wwwAuth()) return wwwUser();
  const { user } = await withAuth();
  return user ? { id: user.id, email: user.email, name: user.firstName ?? null } : null;
}

// The proxy already asked www for this request; its answer counts only with this process's proxy key. If the
// proxy ran elsewhere (no key match), ask www directly.
async function wwwUser(): Promise<User | null> {
  const h = await headers();
  const key = (globalThis as unknown as { __ptProxyKey?: string }).__ptProxyKey;
  if (key && h.get("x-pt-proxy") === key) {
    const raw = h.get("x-pt-user");
    if (!raw) return null;
    try {
      return JSON.parse(decodeURIComponent(raw)) as User;
    } catch {
      return null;
    }
  }
  return (await lookupWwwUser(h.get("cookie"), { url: process.env.WWW_ME_URL || undefined })).user;
}

export class AuthError extends Error {
  status = 401;
  constructor() {
    super("Sign in to do this.");
  }
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError();
  return user;
}
