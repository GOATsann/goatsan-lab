import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { figurePng } from "@/lib/server/papers";
import { errorResponse } from "@/lib/server/http";
import { isUploadId, slugToId } from "@/lib/arxivId";

// One figure crop as PNG. Upload figures are private to the uploader.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/papers/[slug]/figures/[fig]">) {
  try {
    const { slug, fig } = await ctx.params;
    const id = slugToId(slug);
    const png = await figurePng(id, fig.replace(/\.png$/, ""), await currentUser());
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": isUploadId(id) ? "private, max-age=3600" : "public, max-age=86400",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
