import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { recheckOverview } from "@/lib/server/tutor/tutor";

// Dev only: run the numbers check over a saved overview (?paper=<id>) and save the corrected version.
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not here." }, { status: 404 });
  const id = request.nextUrl.searchParams.get("paper") ?? "";
  const out = await recheckOverview(id, await currentUser());
  return NextResponse.json(out ?? { error: "No saved overview." });
}
