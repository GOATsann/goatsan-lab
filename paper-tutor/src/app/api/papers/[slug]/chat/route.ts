import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { chatTurn } from "@/lib/server/tutor/tutor";
import type { AgentPart } from "@/lib/server/tutor/agent";
import type { DrawStep } from "@/lib/scenes/types";
import { slugToId } from "@/lib/arxivId";

// One chat turn of the tutor agent, streamed as NDJSON: {"text"} pieces of the written answer, {"video": true} when
// it decides to show it on the board, {"scene"} per scene, {"cite"} and {"action"} (open a figure or a section),
// then {"done": true} (or {"error"}).
export const maxDuration = 120;

export async function POST(request: NextRequest, ctx: RouteContext<"/api/papers/[slug]/chat">) {
  try {
    const { slug } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      question?: string;
      history?: { role: "user" | "assistant"; text: string }[];
      video?: boolean;
      board?: { say?: string; draw?: DrawStep[] };
    };
    const parts = await chatTurn(slugToId(slug), await currentUser(), {
      question: body.question ?? "",
      history: Array.isArray(body.history) ? body.history : [],
      video: body.video === true,
      board: body.board && typeof body.board === "object" ? body.board : undefined,
    });
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: AgentPart | { done: true } | { error: string }) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          for await (const p of parts) send(p);
          send({ done: true });
        } catch (e) {
          send({ error: (e as Error).message || "The answer stopped." });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
