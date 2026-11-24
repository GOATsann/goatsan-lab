import { NextResponse, type NextRequest } from "next/server";
import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { lookupWwwUserCached, needsUser } from "@/lib/server/wwwSession";

// Login is shared with www.theonlygoatsan.com, in one of two ways (AUTH_MODE):
// - "www": this app has no WorkOS keys. For API requests that need a user, the proxy asks www who is signed in
//   (forwarding the cookies; cached 30 s per session), passes the answer to the route in a header only the proxy
//   can set, and hands any refreshed session cookie back to the browser. This needs OpenNext's default internal
//   middleware (the proxy runs in the same process as the routes); otherwise routes ask www themselves.
// - otherwise WorkOS AuthKit runs here with the same keys as www (when they are set).
// Pages stay public; the dev stub user turns all of this off locally.
const devStub = process.env.NODE_ENV !== "production" && process.env.PAPER_TUTOR_DEV_USER === "1";
const wwwMode = process.env.AUTH_MODE === "www";
const configured = Boolean(
  process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_API_KEY &&
    (process.env.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32 &&
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
);
const authkit = configured && !devStub && !wwwMode ? authkitProxy({ redirectUri: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI }) : null;

// A secret for this server process: the user header counts only with it, so a browser can't send its own.
const g = globalThis as unknown as { __ptProxyKey?: string };
const proxyKey = (g.__ptProxyKey ??= crypto.randomUUID());

export default async function proxy(request: NextRequest, event: Parameters<NonNullable<typeof authkit>>[1]) {
  if (wwwMode && !devStub) {
    const headers = new Headers(request.headers);
    headers.delete("x-pt-user");
    headers.delete("x-pt-proxy");
    // Public reads skip the round trip (and count as nobody); the rest use a 30 s per-session cache.
    const found = needsUser(request.method, request.nextUrl.pathname)
      ? await lookupWwwUserCached(request.headers.get("cookie"), { url: process.env.WWW_ME_URL || undefined })
      : { user: null, setCookies: [] as string[] };
    headers.set("x-pt-user", found.user ? encodeURIComponent(JSON.stringify(found.user)) : "");
    headers.set("x-pt-proxy", proxyKey);
    const res = NextResponse.next({ request: { headers } });
    for (const c of found.setCookies) res.headers.append("set-cookie", c);
    return res;
  }
  if (authkit) return authkit(request, event);
  // Nobody may pass a user header through when the proxy isn't the one setting it.
  const headers = new Headers(request.headers);
  headers.delete("x-pt-user");
  headers.delete("x-pt-proxy");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*"],
};
