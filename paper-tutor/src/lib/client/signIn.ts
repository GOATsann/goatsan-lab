"use client";

import { useSyncExternalStore } from "react";
import { AUTH_ORIGIN, signInHref } from "./useMe";

// Going to sign-in takes three redirects on three hosts (www /auth/signin, WorkOS, the AuthKit page), often a
// second or two. So every path to sign-in goes through here:
// - the pending state shows at once (the button says "Opening sign-in…", and a small pill confirms it),
// - a second tap does nothing,
// - coming back with the browser's back button (a page restored from the back/forward cache) clears it,
// - and on hover, focus or touch we open the connections early and wake www's server, so the hops are quicker.

const WORKOS_ORIGINS = ["https://api.workos.com", process.env.NEXT_PUBLIC_AUTHKIT_ORIGIN ?? ""].filter(Boolean);

let pending = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted && pending) {
      pending = false;
      emit();
    }
  });
}

let warmed = false;
export function warmSignIn() {
  if (warmed || typeof document === "undefined" || !AUTH_ORIGIN) return;
  warmed = true;
  for (const origin of [AUTH_ORIGIN, ...WORKOS_ORIGINS]) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
  // Wake www's server (a cold start is the biggest single delay). The answer isn't read.
  void fetch(`${AUTH_ORIGIN}/api/me`, { mode: "no-cors", credentials: "omit", cache: "no-store" }).catch(() => undefined);
}

// Props for anything that leads to sign-in: warm up on intent.
export const warmProps = { onPointerEnter: warmSignIn, onFocus: warmSignIn, onTouchStart: warmSignIn };

export function goToSignIn(after?: string) {
  if (pending) return;
  pending = true;
  emit();
  warmSignIn();
  const href = signInHref(after);
  // Let the pending state paint before the browser starts leaving the page.
  requestAnimationFrame(() => setTimeout(() => location.assign(href), 0));
}

export function useSignInPending(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => pending,
    () => false,
  );
}
