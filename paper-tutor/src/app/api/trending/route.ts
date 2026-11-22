import { NextResponse } from "next/server";
import { trending } from "@/lib/server/trending";
import { errorResponse } from "@/lib/server/http";

export async function GET() {
  try {
    return NextResponse.json({ papers: await trending() }, { headers: { "Cache-Control": "public, max-age=600" } });
  } catch (e) {
    return errorResponse(e);
  }
}
