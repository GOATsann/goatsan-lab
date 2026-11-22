import { NextResponse, type NextRequest } from "next/server";
import { searchArxiv } from "@/lib/server/arxiv";
import { errorResponse } from "@/lib/server/http";
import { parseArxivId } from "@/lib/arxivId";

// Search arXiv, or, when the box holds an arXiv link or id, say which paper to open.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const start = Math.max(0, Math.min(500, Number(request.nextUrl.searchParams.get("start")) || 0));
  const id = parseArxivId(q);
  if (id) return NextResponse.json({ open: id, papers: [] });
  try {
    return NextResponse.json({ papers: await searchArxiv(q, start) }, { headers: { "Cache-Control": "public, max-age=600" } });
  } catch (e) {
    return errorResponse(e);
  }
}
