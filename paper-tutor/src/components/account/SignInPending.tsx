"use client";

import { LoaderCircle } from "lucide-react";
import { useSignInPending } from "@/lib/client/signIn";

// A small pill while the browser is on its way to sign-in, wherever that was started from.
export function SignInPending() {
  const pending = useSignInPending();
  if (!pending) return null;
  return (
    <div className="signin-pending" role="status" aria-live="polite">
      <LoaderCircle size={16} strokeWidth={2.5} className="signin-spin" aria-hidden />
      Opening sign-in…
    </div>
  );
}
