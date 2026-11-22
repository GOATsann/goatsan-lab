import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { getState } from "@/lib/server/papers";
import { errorResponse, noStore } from "@/lib/server/http";
import { slugToId } from "@/lib/arxivId";

// A paper's metadata and whatever reading has produced so far.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/papers/[slug]">) {
  try {
    const { slug } = await ctx.params;
    const state = await getState(slugToId(slug), await currentUser());
    const { owner: _owner, ...meta } = state.meta;
    return NextResponse.json({ ...state, meta }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
