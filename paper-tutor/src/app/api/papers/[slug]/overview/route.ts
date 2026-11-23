import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { errorResponse, noStore } from "@/lib/server/http";
import { sceneStream } from "@/lib/server/ndjson";
import { cachedOverview, overview } from "@/lib/server/tutor/tutor";
import { slugToId } from "@/lib/arxivId";

// GET: the saved overview, if anyone has made it (free for everyone, no sign-in).
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/papers/[slug]/overview">) {
  try {
    const { slug } = await ctx.params;
    const saved = await cachedOverview(slugToId(slug), await currentUser());
    return NextResponse.json({ overview: saved }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST: play the overview, writing it live (and saving it) when nobody has made it yet. Making one needs sign-in
// and counts as one of the day's new papers.
export const maxDuration = 300;

export async function POST(request: NextRequest, ctx: RouteContext<"/api/papers/[slug]/overview">) {
  try {
    const { slug } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { voice?: boolean; model?: string };
    // Development only: try another model for the overview (for measuring); production always uses the default.
    const model = process.env.NODE_ENV !== "production" && body.model?.startsWith("claude-") ? body.model : undefined;
    const out = await overview(slugToId(slug), await currentUser(), { voice: body.voice !== false, model });
    return sceneStream({ theme: out.theme, cached: out.cached }, out.scenes);
  } catch (e) {
    return errorResponse(e);
  }
}
