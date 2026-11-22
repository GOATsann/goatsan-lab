"use client";

import type { Scene } from "@/lib/scenes/types";
import type { ThemeName } from "@/lib/types";

// Reads the tutor's NDJSON scene stream: one scene per line, handed over the moment it arrives.
export class StreamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function readScenes(
  url: string,
  body: unknown,
  on: { meta?: (m: { theme?: ThemeName; cached?: boolean }) => void; scene: (s: Scene) => void },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => null);
    throw new StreamError(res.status, d?.error ?? `The tutor couldn't start (${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { meta?: { theme?: ThemeName; cached?: boolean }; scene?: Scene; error?: string; done?: boolean };
      if (msg.meta) on.meta?.(msg.meta);
      if (msg.scene) on.scene(msg.scene);
      if (msg.error) throw new StreamError(500, msg.error);
    }
    if (done) break;
  }
}

export async function readText(url: string, body: unknown, onChunk: (all: string) => void, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => null);
    throw new StreamError(res.status, d?.error ?? `The tutor couldn't answer (${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let all = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      all += dec.decode(value, { stream: true });
      onChunk(all);
    }
    if (done) break;
  }
  return all;
}
