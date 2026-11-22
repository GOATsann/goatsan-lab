import "server-only";
import { NextResponse } from "next/server";

// Errors that carry a status (auth, limits, not found, upstream) become a JSON { error } the UI can show.
export function errorResponse(e: unknown): NextResponse {
  const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 500;
  const message = status === 500 ? "Something went wrong on the server." : (e as Error).message;
  if (status === 500) console.error(e);
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export const noStore = { "Cache-Control": "private, no-store" };
