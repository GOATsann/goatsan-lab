import "server-only";
import type { Scene } from "@/lib/scenes/types";

// Scenes go to the browser as NDJSON: one JSON object per line, flushed as soon as each scene is ready.
//   {"meta":{...}}  {"scene":{...}} ...  {"done":true}   or   {"error":"..."}
export function sceneStream(meta: Record<string, unknown>, scenes: AsyncGenerator<Scene>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send({ meta });
      try {
        for await (const scene of scenes) send({ scene });
        send({ done: true });
      } catch (e) {
        send({ error: (e as Error).message || "The tutor stopped." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

export function textStream(chunks: AsyncGenerator<string>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const c of chunks) controller.enqueue(enc.encode(c));
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n[The answer stopped: ${(e as Error).message}]`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
