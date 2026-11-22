import { NextResponse, type NextRequest } from "next/server";
import { browseArxiv, CATEGORIES } from "@/lib/server/arxiv";
import { errorResponse } from "@/lib/server/http";

// The newest papers in one arXiv category.
export async function GET(request: NextRequest) {
  const cat = request.nextUrl.searchParams.get("cat") ?? "cs.LG";
  const start = Math.max(0, Math.min(500, Number(request.nextUrl.searchParams.get("start")) || 0));
  if (!CATEGORIES.some((c) => c.id === cat)) return NextResponse.json({ error: "Unknown category." }, { status: 400 });
  try {
    return NextResponse.json({ papers: await browseArxiv(cat, start) }, { headers: { "Cache-Control": "public, max-age=600" } });
  } catch (e) {
    return errorResponse(e);
  }
}
