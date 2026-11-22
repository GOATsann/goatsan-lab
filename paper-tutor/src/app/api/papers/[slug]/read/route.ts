import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readPaper } from "@/lib/server/papers";
import { errorResponse, noStore } from "@/lib/server/http";
import { slugToId } from "@/lib/arxivId";

// Read the paper with the AI (the structure pass). Sign-in needed; counts toward the daily limit only the
// first time anyone reads this paper.
export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/papers/[slug]/read">) {
  try {
    const user = await requireUser();
    const { slug } = await ctx.params;
    const state = await readPaper(slugToId(slug), user);
    const { owner: _owner, ...meta } = state.meta;
    return NextResponse.json({ ...state, meta }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
