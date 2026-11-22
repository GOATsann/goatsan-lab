import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { createUpload, UPLOAD_MAX_BYTES } from "@/lib/server/papers";
import { errorResponse, noStore } from "@/lib/server/http";

// Upload a PDF. Sign-in needed; the paper stays private to the uploader. Size and page caps in papers.ts.
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > UPLOAD_MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ error: `PDFs can be up to ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF to upload." }, { status: 400 });
    const meta = await createUpload(user, Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ id: meta.id }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
