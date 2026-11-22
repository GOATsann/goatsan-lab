import { NextResponse, type NextRequest } from "next/server";
import { searchArxiv } from "@/lib/server/arxiv";
import { searchS2 } from "@/lib/server/s2";
import { errorResponse } from "@/lib/server/http";
import { parseArxivId } from "@/lib/arxivId";
import type { PaperCard } from "@/lib/types";

// Search arXiv and Semantic Scholar together (forgiving spellings), or, when the box holds an arXiv link or id,
// say which paper to open. Other links are opened as PDFs by the page (/api/link).
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const id = parseArxivId(q);
  if (id) return NextResponse.json({ open: id, papers: [] });
  try {
    const [arxiv, s2] = await Promise.allSettled([searchArxiv(q), searchS2(q)]);
    if (arxiv.status === "rejected" && s2.status === "rejected") throw arxiv.reason;
    const a = arxiv.status === "fulfilled" ? arxiv.value : [];
    const b = s2.status === "fulfilled" ? s2.value : [];
    // Semantic Scholar ranks by relevance well and knows non-arXiv papers; arXiv fills in the rest.
    const seen = new Set<string>();
    const papers: PaperCard[] = [];
    for (const p of [...b.slice(0, 12), ...a, ...b.slice(12)]) {
      const key = p.id.startsWith("s2_") ? p.title.toLowerCase() : p.id;
      if (seen.has(key) || seen.has(p.title.toLowerCase())) continue;
      seen.add(key);
      seen.add(p.title.toLowerCase());
      if (p.id.startsWith("s2_") && !p.pdfUrl && !p.link) continue;
      papers.push(p);
    }
    return NextResponse.json(
      { papers: papers.slice(0, 30), sources: { arxiv: arxiv.status === "fulfilled", semanticScholar: s2.status === "fulfilled" } },
      { headers: { "Cache-Control": "public, max-age=600" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
