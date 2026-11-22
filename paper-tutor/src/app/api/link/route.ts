import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { createFromLink } from "@/lib/server/papers";
import { errorResponse, noStore } from "@/lib/server/http";

// Open a PDF from any https link (a whitepaper, a lab's site). Sign-in needed; it stays private to that person.
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const { url } = (await request.json().catch(() => ({}))) as { url?: string };
    if (typeof url !== "string" || !url.trim()) return NextResponse.json({ error: "Paste a link to a PDF." }, { status: 400 });
    const meta = await createFromLink(user, url);
    return NextResponse.json({ id: meta.id }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
