import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { cachedSpeech, MAX_SENTENCE_CHARS, speak, VOICES, type Voice } from "@/lib/server/tts";
import { errorResponse } from "@/lib/server/http";
import { hitRate } from "@/lib/server/rate";

// One sentence of the tutor's voice as MP3. Already-made sentences are free for everyone; making a new one
// needs sign-in (and is rate limited), so the endpoint can't be used as a free TTS service.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { text?: string; voice?: string };
    const text = (body.text ?? "").replace(/\s+/g, " ").trim();
    const voice = (VOICES as readonly string[]).includes(body.voice ?? "") ? (body.voice as Voice) : "coral";
    if (!text || text.length > MAX_SENTENCE_CHARS) return NextResponse.json({ error: "One sentence, please." }, { status: 400 });

    const hit = await cachedSpeech(text, voice);
    if (hit) return audio(hit);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in to hear the voice." }, { status: 401 });
    if (!hitRate(`tts:${user.id}`, 120, 60 * 60_000)) {
      return NextResponse.json({ error: "Too many voice lines this hour." }, { status: 429 });
    }
    return audio(await speak(text, voice));
  } catch (e) {
    return errorResponse(e);
  }
}

function audio(data: Buffer) {
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
  });
}
