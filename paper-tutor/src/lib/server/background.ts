import "server-only";
import { after } from "next/server";

// Work that outlives the response (downloading a linked PDF, cropping figures, the full map). On AWS Lambda a
// plain unawaited promise freezes once the response is sent; after() keeps the function alive until it settles
// (OpenNext's waitUntil). The job starts now, not after the response.
export function background(job: () => Promise<unknown>) {
  const p = job().catch((e) => console.error("[background]", e));
  try {
    after(p);
  } catch {
    // Outside a request (tests, scripts): the promise just runs.
  }
}
