import "server-only";
import { withAuth } from "@workos-inc/authkit-nextjs";

// One login for every theonlygoatsan.com app (WorkOS AuthKit, run by the personal site). This app never
// handles the callback: sign-in starts and ends on www, and the sealed `wos-session` cookie is shared across
// subdomains. Pages are public; server code asks who is signed in only when someone acts.

export type User = { id: string; email: string; name: string | null };

// Login is on only when every WorkOS setting is present.
export function authConfigured(): boolean {
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
  const { user } = await withAuth();
  return user ? { id: user.id, email: user.email, name: user.firstName ?? null } : null;
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
