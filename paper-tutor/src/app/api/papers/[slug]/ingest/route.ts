import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { ingestPaper } from "@/lib/server/papers";
import { errorResponse, noStore } from "@/lib/server/http";
import { hitRate } from "@/lib/server/rate";
import { slugToId } from "@/lib/arxivId";

// Get the paper's text and figure crops (LaTeX source first, then the PDF). No AI, so no sign-in; results are
// saved once and shared, and arXiv calls go through the 3-second queue.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/papers/[slug]/ingest">) {
  try {
    const { slug } = await ctx.params;
    const ip = request.headers.get("x-client-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
    if (!hitRate(`ingest:${ip}`, 20, 60 * 60_000)) {
      return NextResponse.json({ error: "Too many papers opened this hour." }, { status: 429 });
    }
    const ingest = await ingestPaper(slugToId(slug), await currentUser());
    return NextResponse.json({ ingest }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
