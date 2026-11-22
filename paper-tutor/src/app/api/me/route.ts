import { NextResponse } from "next/server";
import { authConfigured, currentUser, devUserEnabled } from "@/lib/server/auth";
import { noStore } from "@/lib/server/http";

// Who is signed in (or nobody), and whether login is on at all. Only what the page shows: never tokens.
export async function GET() {
  if (!authConfigured() && !devUserEnabled()) return NextResponse.json({ user: null, auth: false }, { headers: noStore });
  const user = await currentUser();
  return NextResponse.json({ user, auth: true, dev: devUserEnabled() }, { headers: noStore });
}
