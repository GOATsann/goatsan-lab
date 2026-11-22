import { NextResponse, type NextRequest } from "next/server";
import { iconSvg } from "@/lib/server/iconify";

// One Iconify icon (from an allowed, open-licensed set), served from our store.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/icons/[prefix]/[name]">) {
  const { prefix, name } = await ctx.params;
  const svg = await iconSvg(`${prefix}:${name.replace(/\.svg$/, "")}`).catch(() => null);
  if (!svg) return NextResponse.json({ error: "No such icon." }, { status: 404 });
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=604800, immutable",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
