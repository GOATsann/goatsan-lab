import { NextResponse, type NextRequest } from "next/server";
import { authkitProxy } from "@workos-inc/authkit-nextjs";

// Login (WorkOS AuthKit, shared with www.theonlygoatsan.com). Pages stay public: the proxy only runs on the APIs
// that need to know who is asking. With no WorkOS keys, or the dev stub user on, it does nothing.
const configured = Boolean(
  process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_API_KEY &&
    (process.env.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32 &&
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
);
const devStub = process.env.NODE_ENV !== "production" && process.env.PAPER_TUTOR_DEV_USER === "1";
const authkit = configured && !devStub ? authkitProxy({ redirectUri: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI }) : null;

export default function proxy(request: NextRequest, event: Parameters<NonNullable<typeof authkit>>[1]) {
  return authkit ? authkit(request, event) : NextResponse.next();
}

export const config = {
  matcher: ["/api/me", "/api/papers/:path*", "/api/upload", "/api/link", "/api/tts"],
};
