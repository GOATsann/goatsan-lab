"use client";

import { useEffect, useState } from "react";

// Who is signed in, shared by every component on the page (one /api/me call).
// undefined = still checking, null = nobody.
export type Me = { id: string; email: string; name: string | null };

// Login lives on the main site (one redirect URI); empty = this site (local dev).
export const AUTH_ORIGIN = process.env.NEXT_PUBLIC_AUTH_ORIGIN ?? "";

type MeState = { user: Me | null; auth: boolean };
let pending: Promise<MeState> | null = null;

function fetchMe(): Promise<MeState> {
  pending ??= fetch("/api/me", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { user: null, auth: false }))
    .then((d: Partial<MeState>) => ({ user: d.user ?? null, auth: Boolean(d.auth) }))
    .catch(() => ({ user: null, auth: false }));
  return pending;
}

function useMeState(): MeState | undefined {
  const [state, setState] = useState<MeState | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchMe().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

// The signed-in person: undefined = still checking, null = nobody.
export function useMe(): Me | null | undefined {
  const s = useMeState();
  return s === undefined ? undefined : s.user;
}

// Is login switched on on this deploy? (Off until the WorkOS keys are set.)
// undefined = still checking.
export function useAuthEnabled(): boolean | undefined {
  return useMeState()?.auth;
}

// Where to go to sign in and come back to this page (with an optional
// "after" action to finish when they return).
export function signInHref(after?: string): string {
  const back = new URL(location.href);
  if (after) back.searchParams.set("after", after);
  return `${AUTH_ORIGIN}/auth/signin?return=${encodeURIComponent(back.toString())}`;
}

export const signOutHref = () => `${AUTH_ORIGIN}/auth/signout?return=${encodeURIComponent(location.href)}`;
