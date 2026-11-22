import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { sceneStream } from "@/lib/server/ndjson";
import { liveScenes, type LiveRequest } from "@/lib/server/tutor/tutor";
import { slugToId } from "@/lib/arxivId";

// Live whiteboard scenes: a section deep dive, "Explain this" on an equation or figure, or an answer to a
// question (drawn on the board the viewer paused on). Deep dives and explanations are saved and replayed free.
export const maxDuration = 120;

export async function POST(request: NextRequest, ctx: RouteContext<"/api/papers/[slug]/tutor">) {
  try {
    const { slug } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Partial<LiveRequest> & Record<string, unknown>;
    let req: LiveRequest;
    if (body.mode === "deepdive" && typeof body.section === "string") req = { mode: "deepdive", section: body.section };
    else if (body.mode === "explain") req = { mode: "explain", eq: typeof body.eq === "string" ? body.eq : undefined, fig: typeof body.fig === "string" ? body.fig : undefined };
    else if (body.mode === "ask" && typeof body.question === "string") {
      req = {
        mode: "ask",
        question: body.question,
        history: Array.isArray(body.history) ? (body.history as LiveRequest extends { history: infer H } ? H : never) : [],
        board: body.board && typeof body.board === "object" ? (body.board as { say?: string; draw?: never[] }) : undefined,
      };
    } else return Response.json({ error: "Unknown request." }, { status: 400 });
    const out = await liveScenes(slugToId(slug), await currentUser(), req);
    return sceneStream({ theme: out.theme, cached: out.cached }, out.scenes);
  } catch (e) {
    return errorResponse(e);
  }
}
