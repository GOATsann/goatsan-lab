import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { getMeta } from "@/lib/server/papers";
import { progressOf } from "@/lib/server/progress";
import { errorResponse, noStore } from "@/lib/server/http";
import { slugToId } from "@/lib/arxivId";

// What the server is doing for this paper right now (downloading, reading pages, finding figures, mapping,
// writing the overview), for the loading state. Polled about once a second while something is running.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/papers/[slug]/progress">) {
  try {
    const { slug } = await ctx.params;
    const id = slugToId(slug);
    await getMeta(id, await currentUser()); // uploads: only the owner
    return NextResponse.json({ progress: await progressOf(id) }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
