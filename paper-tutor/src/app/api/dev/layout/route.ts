import { NextResponse } from "next/server";
import { attentionDemo } from "@/lib/scenes/demo-attention";
import { layoutScenes } from "@/lib/scenes/layout";
import { getStore } from "@/lib/server/store";
import type { Ingest } from "@/lib/types";
import type { SavedScenes } from "@/lib/server/tutor/generate";

// Dev only: run the layout checks over the hand-written demo and every saved AI scene list, and list what
// they had to fix. (Saved lists were already fixed when written, so they should come back clean.)
export async function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not here." }, { status: 404 });
  const store = getStore();
  const ingest = await store.getJSON<Ingest>("papers/1706.03762/ingest.json");
  const figs = Object.fromEntries((ingest?.figures ?? []).map((f) => [f.id, f]));
  const out: Record<string, string[]> = { demo: layoutScenes(attentionDemo.scenes, figs).issues };
  for (const id of ["1706.03762", "2412.10410"]) {
    const ov = await store.getJSON<SavedScenes>(`papers/${id}/overview.json`);
    const ing = await store.getJSON<Ingest>(`papers/${id}/ingest.json`);
    if (ov) out[`overview ${id}`] = layoutScenes(ov.scenes, Object.fromEntries((ing?.figures ?? []).map((f) => [f.id, f]))).issues;
  }
  return NextResponse.json(out);
}
