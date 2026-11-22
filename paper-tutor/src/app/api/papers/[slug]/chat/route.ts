import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { textStream } from "@/lib/server/ndjson";
import { chatText } from "@/lib/server/tutor/tutor";
import { slugToId } from "@/lib/arxivId";

// Chat with text answers, streamed. The whole paper is in the (cached) prompt; answers cite sections as [[id]].
export const maxDuration = 120;

export async function POST(request: NextRequest, ctx: RouteContext<"/api/papers/[slug]/chat">) {
  try {
    const { slug } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { question?: string; history?: { role: "user" | "assistant"; text: string }[] };
    const chunks = await chatText(slugToId(slug), await currentUser(), body.question ?? "", Array.isArray(body.history) ? body.history : []);
    return textStream(chunks);
  } catch (e) {
    return errorResponse(e);
  }
}
