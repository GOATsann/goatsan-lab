import "server-only";
import { createHash } from "node:crypto";
import { getStore } from "./store";

// The tutor's voice: OpenAI text-to-speech, one sentence per request, so the first word plays quickly.
// Every sentence is cached by its exact text, so a replayed overview costs nothing.
export const TTS_MODEL = "gpt-4o-mini-tts";
export const VOICES = ["coral", "ash", "sage", "verse"] as const;
export type Voice = (typeof VOICES)[number];
const INSTRUCTIONS =
  "A friendly tutor explaining a research paper at a whiteboard, like a good science explainer video. Speak at a lively, natural conversational pace (brisk, never slow or drawn out), with clear words and light enthusiasm.";

export const MAX_SENTENCE_CHARS = 600;
const SPEED = 1.1;

export function ttsKey(text: string, voice: Voice): string {
  const h = createHash("sha256").update(`${TTS_MODEL}|${voice}|${SPEED}|${INSTRUCTIONS}|${text}`).digest("hex").slice(0, 40);
  return `tts/${h}.mp3`;
}

export async function cachedSpeech(text: string, voice: Voice): Promise<Buffer | null> {
  return getStore().getBlob(ttsKey(text, voice));
}

// The same sentence asked for twice at once (two tabs, prefetch + play) is made once.
const g = globalThis as unknown as { __ttsInflight?: Map<string, Promise<Buffer>> };
const inflight = (g.__ttsInflight ??= new Map());

export async function speak(text: string, voice: Voice): Promise<Buffer> {
  const key = ttsKey(text, voice);
  const running = inflight.get(key);
  if (running) return running;
  const job = make(text, voice, key).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function make(text: string, voice: Voice, key: string): Promise<Buffer> {
  const store = getStore();
  const hit = await store.getBlob(key);
  if (hit) return hit;
  const key_ = process.env.OPENAI_API_KEY;
  if (!key_) throw new Error("Voice is off: no OpenAI key on the server.");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key_}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice, input: text, instructions: INSTRUCTIONS, response_format: "mp3", speed: SPEED }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenAI TTS answered ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  await store.putBlob(key, audio);
  console.log(`[tts] ${text.length} chars (${voice})`);
  return audio;
}
