"use client";

import { useEffect, useRef, useState } from "react";
import { signOutHref, useAuthEnabled, useMe } from "@/lib/client/useMe";
import { goToSignIn, useSignInPending, warmProps } from "@/lib/client/signIn";
import { LoaderCircle } from "lucide-react";
import "./account.css";

// The one account control for every theonlygoatsan.com app page, always top-right (copied from the personal
// site so it looks the same everywhere). Signed out: "Sign in". Signed in: an initial that opens a small menu
// with the email and "Sign out".
export function AccountButton() {
  const signingIn = useSignInPending();
  const me = useMe();
  const authOn = useAuthEnabled();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  if (authOn === false) return null; // login not switched on for this deploy
  if (me === undefined) return <div className="acct" aria-hidden />;

  if (!me) {
    return (
      <div className="acct">
        <a
          className="acct-signin"
          href="#sign-in"
          aria-disabled={signingIn || undefined}
          {...warmProps}
          onClick={(e) => {
            e.preventDefault();
            goToSignIn();
          }}
        >
          {signingIn ? (
            <>
              <LoaderCircle size={14} strokeWidth={2.5} className="signin-spin" aria-hidden />
              Opening sign-in…
            </>
          ) : (
            "Sign in"
          )}
        </a>
      </div>
    );
  }

  const initial = (me.name || me.email).trim().charAt(0).toUpperCase();
  return (
    <div className="acct" ref={box}>
      <button
        type="button"
        className="acct-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${me.email}`}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
      </button>
      {open ? (
        <div className="acct-menu" role="menu">
          <p className="acct-email">{me.email}</p>
          <a role="menuitem" className="acct-item" href={signOutHref()}>
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}
