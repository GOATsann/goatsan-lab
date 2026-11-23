import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "../store";
import { LIVE_MODEL } from "./generate";
import type { PaperMeta, Pronunciation, Structure } from "@/lib/types";

// Spoken lines are written for the ear: the board keeps "GR00T", the voice says "Groot". The list of a paper's
// tricky names comes from the paper map (an LLM pass); before the map exists, a quick pass over the title and the
// start of the paper makes one. Then every "say" line is rewritten with it, plus one general rule for names
// that use digits as letters.

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const SCHEMA = {
  type: "object",
  properties: {
    pronunciations: {
      type: "array",
      items: {
        type: "object",
        properties: { written: { type: "string" }, spoken: { type: "string" } },
        required: ["written", "spoken"],
        additionalProperties: false,
      },
    },
  },
  required: ["pronunciations"],
  additionalProperties: false,
};

const clean = (list: unknown): Pronunciation[] =>
  (Array.isArray(list) ? list : [])
    .filter((p): p is Pronunciation => !!p && typeof p.written === "string" && typeof p.spoken === "string")
    .map((p) => ({ written: p.written.trim().slice(0, 40), spoken: p.spoken.trim().slice(0, 60) }))
    .filter((p) => p.written && p.spoken && p.written !== p.spoken)
    .slice(0, 20);

export async function pronunciations(dirKey: string, meta: PaperMeta, structure: Structure | null, text: string): Promise<Pronunciation[]> {
  if (structure?.pronunciations) return clean(structure.pronunciations);
  const store = getStore();
  const key = `${dirKey}/say.json`;
  const saved = await store.getJSON<{ list: Pronunciation[] }>(key);
  if (saved) return saved.list;
  let list: Pronunciation[] = [];
  try {
    const msg = await anthropic().messages.create({
      model: LIVE_MODEL,
      max_tokens: 1500,
      thinking: { type: "between_tools" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: `List how to say this paper's tricky names out loud, for a text-to-speech voice: stylised spellings,
digits used as letters, and acronyms that are spelled out letter by letter (for example "GR00T" -> "Groot",
"LLM" -> "L L M"). Use how people in the field actually say them: names normally said as a word stay a word
(NVIDIA -> "Nvidia", NASA -> "Nasa"). Only names a voice would likely get wrong; at most 15; [] if none.

Title: ${meta.title}
${meta.abstract}

${text.slice(0, 8000)}`,
        },
      ],
    });
    const out = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    list = clean((JSON.parse(out) as { pronunciations: unknown }).pronunciations);
  } catch (e) {
    console.error("[say] list failed:", (e as Error).message);
  }
  await store.putJSON(key, { list });
  return list;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Rewrite a spoken line for the ear.
export function speakable(say: string, list: Pronunciation[]): string {
  let out = say;
  for (const p of [...list].sort((a, b) => b.written.length - a.written.length)) {
    out = out.replace(new RegExp(`(?<![\\w-])${escape(p.written)}(?![\\w])`, "g"), p.spoken);
  }
  // A zero used as the letter O inside a name ("GR00T", "R0B0T"): read it as O, and say an all-caps name as a word.
  out = out.replace(/\b[A-Za-z]+(?:0+[A-Za-z]+)+\b/g, (w) => {
    const word = w.replace(/0/g, "o");
    const letters = w.replace(/0/g, "");
    return letters === letters.toUpperCase() ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;
  });
  // A version number after a name ("Groot 2", "Llama 3") reads more reliably as a word.
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  out = out.replace(/\b([A-Z][A-Za-z]+) (\d)(?![\d.,%])\b/g, (_m, name: string, d: string) => `${name} ${words[Number(d)]}`);
  return out;
}
