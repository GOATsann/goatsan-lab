import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { themeFor, type Figure, type PaperMeta, type PaperType, type Pronunciation, type Structure } from "@/lib/types";
import { recordAnthropic } from "./spend";

// Mapping a paper, in two steps so the overview can start early:
// 1. A quick map (seconds): from the title, abstract, introduction, conclusion and figure captions, one fast call
//    gives what the paper does, its type (the whiteboard style), an outline and how to say its names.
// 2. The full map (in the background): the paper in chunks, read in parallel, each giving its sections, key claims,
//    equations and figures; then merged. Deep dives, Explain this and the Sections tab use it.
export const MAP_MODEL = "claude-sonnet-5-5";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const PRON = { type: "array", items: obj({ written: str, spoken: str }) };

export type QuickMap = {
  oneLine: string;
  paperType: PaperType;
  outline: { title: string; summary: string }[];
  pronunciations: Pronunciation[];
};

const QUICK_SCHEMA = obj({
  oneLine: str,
  paperType: { type: "string", enum: ["math", "ai-systems", "bio-medicine", "physics", "other"] },
  outline: { type: "array", items: obj({ title: str, summary: str }) },
  pronunciations: PRON,
});

const PRON_RULE = `pronunciations: how to say the paper's tricky names out loud for a text-to-speech voice: stylised
spellings, digits used as letters, acronyms spelled out letter by letter (for example "GR00T" -> "Groot", "LLM" ->
"L L M"), as people in the field say them; names normally said as a word stay a word (NVIDIA -> "Nvidia"). Only
names a voice would likely get wrong; at most 15; [] if none.`;

async function structured<T>(system: string, user: string, schema: Record<string, unknown>, maxTokens: number): Promise<T> {
  const msg = await anthropic().messages.create({
    model: MAP_MODEL,
    max_tokens: maxTokens,
    system,
    thinking: { type: "between_tools" },
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  });
  void recordAnthropic(msg.model, msg.usage);
  if (msg.stop_reason === "refusal") throw new Error("The AI declined to read this paper.");
  return JSON.parse(msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")) as T;
}

// Figure captions straight from the text ("Figure 3: ...") when the crops aren't ready yet.
const captionLines = (text: string) =>
  [...text.matchAll(/(?:^|\n)\s*((?:Figure|Fig\.)\s*\d+[:.][^\n]{10,300})/g)].map((m) => m[1].trim()).slice(0, 30);

export async function quickMap(meta: PaperMeta, text: string): Promise<QuickMap> {
  const intro = text.slice(0, 14_000);
  const tail = text.length > 30_000 ? text.slice(-9_000) : "";
  const caps = captionLines(text).join("\n");
  const out = await structured<QuickMap>(
    `You skim a research paper fast and sketch it for a tutor. Return JSON that matches the schema.
- oneLine: what the paper does, in one plain sentence.
- paperType: "math" for proof- or derivation-heavy papers, "ai-systems" for AI, ML and computer systems,
  "bio-medicine" for biology and medicine, "physics" for physics, else "other".
- outline: the paper's main sections in order (at most 10), each with a one-sentence summary.
- ${PRON_RULE}
Only what the text says.`,
    `Title: ${meta.title}
${meta.abstract ? `Abstract: ${meta.abstract}\n` : ""}
Beginning of the paper:
${intro}
${tail ? `\nEnd of the paper:\n${tail}\n` : ""}
${caps ? `Figure captions:\n${caps}` : ""}`,
    QUICK_SCHEMA,
    4000,
  );
  return { ...out, pronunciations: out.pronunciations ?? [] };
}

const CHUNK_SCHEMA = obj({
  sections: { type: "array", items: obj({ title: str, level: { type: "integer" }, summary: str }) },
  claims: { type: "array", items: obj({ text: str, section: str }) },
  equations: {
    type: "array",
    items: obj({ tex: str, meaning: str, section: str, symbols: { type: "array", items: obj({ tex: str, meaning: str }) } }),
  },
  figures: { type: "array", items: obj({ id: str, caption: str, explanation: str, section: str }) },
});

type Chunk = {
  sections: { title: string; level: number; summary: string }[];
  claims: { text: string; section: string }[];
  equations: { tex: string; meaning: string; section: string; symbols: { tex: string; meaning: string }[] }[];
  figures: { id: string; caption: string; explanation: string; section: string }[];
};

// Split on paragraph breaks into at most `n` pieces of similar size.
function chunks(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + size);
    if (end < text.length) {
      const brk = text.lastIndexOf("\n\n", end);
      if (brk > at + size * 0.6) end = brk;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

const slug = (t: string) =>
  t.toLowerCase().replace(/^[\d.\s]+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "section";

export async function fullMap(
  meta: PaperMeta,
  text: string,
  figures: Figure[],
  quick: QuickMap,
  onChunk?: (done: number, total: number) => void,
): Promise<Structure> {
  const n = Math.max(1, Math.min(6, Math.ceil(text.length / 40_000)));
  const parts = chunks(text, n);
  const figList = figures.length ? figures.map((f) => `${f.id}: ${f.caption}`).join("\n") : "(none)";
  let done = 0;
  onChunk?.(0, parts.length);
  const results = await Promise.all(
    parts.map(async (part, i) => {
      const r = await structured<Chunk>(
        `You map one part of a research paper for a tutor that explains it on a whiteboard. Return JSON that matches
the schema, for THIS PART only:
- sections: the sections and subsections that appear in this part, in order (level 1 = section, 2 = subsection),
  each with a 1-2 sentence plain summary. Skip acknowledgements and references.
- claims: the key claims or results stated in this part (0 to 5), with the title of their section. Exact numbers.
- equations: the equations in this part that matter (at most 6), as KaTeX LaTeX without $, author macros
  expanded, each with a one-sentence meaning, its section title, and the symbols a reader must know.
- figures: figures from the list below that this part discusses, keeping their id, with a plain caption, a 1-2
  sentence explanation, and their section title.`,
        `Paper: ${meta.title}
Part ${i + 1} of ${parts.length}.
Figures in the paper (id: caption):
${figList}

<part>
${part}
</part>`,
        CHUNK_SCHEMA,
        8000,
      );
      onChunk?.(++done, parts.length);
      return r;
    }),
  );

  // Merge, in paper order: section ids are unique slugs; claims, equations and figures point at them.
  const sections: Structure["sections"] = [];
  const byTitle = new Map<string, string>();
  // Chunks number sections differently ("4. Method" vs "Method"): compare and show titles without the numbers.
  const plain = (t: string) => t.replace(/^\s*(\d+(\.\d+)*\.?|[A-Z](\.\d+)*\.)\s+/, "").replace(/\s*\((cont\.|continued)\)\s*$/i, "").trim();
  const keyOf = (t: string) => plain(t).toLowerCase();
  for (const r of results) {
    for (const s of r.sections) {
      const title = plain(s.title);
      const key = keyOf(s.title);
      if (!title || byTitle.has(key) || /^(references|bibliography|acknowledge?ments?)\b/i.test(title)) continue;
      let id = slug(title);
      while (sections.some((x) => x.id === id)) id = `${id}-2`;
      byTitle.set(key, id);
      sections.push({ id, title, level: Math.max(1, Math.min(3, s.level || 1)), summary: s.summary });
    }
  }
  const secId = (title: string) => byTitle.get(keyOf(title)) ?? sections[0]?.id ?? "intro";
  const known = new Set(figures.map((f) => f.id));
  const seenFig = new Set<string>();
  return {
    paperType: quick.paperType,
    theme: themeFor(quick.paperType),
    oneLine: quick.oneLine,
    sections,
    claims: results.flatMap((r) => r.claims.map((c) => ({ text: c.text, section: secId(c.section) }))).slice(0, 10),
    equations: results
      .flatMap((r) => r.equations)
      .slice(0, 15)
      .map((e, i) => ({ id: `eq${i + 1}`, tex: e.tex, meaning: e.meaning, section: secId(e.section), symbols: e.symbols })),
    figures: results
      .flatMap((r) => r.figures)
      .filter((f) => known.has(f.id) && !seenFig.has(f.id) && seenFig.add(f.id))
      .map((f) => ({ ...f, section: secId(f.section) })),
    pronunciations: quick.pronunciations,
    model: MAP_MODEL,
    createdAt: new Date().toISOString(),
  };
}
