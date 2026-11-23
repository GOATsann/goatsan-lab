import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { themeFor, type Figure, type PaperMeta, type Structure } from "@/lib/types";

// The one AI pass over a paper: sections, key claims, equations with their symbols, figures with captions, and
// the paper type (which picks the whiteboard theme). One call per paper; the result is saved and reused.
export const STRUCTURE_MODEL = "claude-opus-5-5";

const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const SCHEMA = obj({
  paperType: { type: "string", enum: ["math", "ai-systems", "bio-medicine", "physics", "other"] },
  oneLine: str,
  sections: { type: "array", items: obj({ id: str, title: str, level: { type: "integer" }, summary: str }) },
  claims: { type: "array", items: obj({ text: str, section: str }) },
  equations: {
    type: "array",
    items: obj({ id: str, tex: str, meaning: str, section: str, symbols: { type: "array", items: obj({ tex: str, meaning: str }) } }),
  },
  figures: { type: "array", items: obj({ id: str, caption: str, explanation: str, section: str }) },
  pronunciations: { type: "array", items: obj({ written: str, spoken: str }) },
});

const SYSTEM = `You read research papers and map their structure for a tutor that explains them on a whiteboard.
Return JSON that matches the schema. Rules:
- sections: the paper's real sections and subsections in order (level 1 = section, 2 = subsection). id is a short
  slug ("intro", "attention", "results"). summary: 1-2 plain sentences on what that section says, for a smart reader
  new to the field. Skip acknowledgements and references.
- claims: the 3-8 key claims or results, each tied to the id of the section it comes from. Keep numbers exact.
- equations: the equations that matter for understanding (at most 15), as KaTeX-compatible LaTeX without $ or
  equation environments, with the author's macros expanded. id is "eq1", "eq2"... in paper order. meaning: one
  plain sentence. symbols: every symbol a reader must know, as LaTeX plus a short meaning.
- figures: one entry per figure in the provided figure list, keeping its id, with the caption in plain words and a
  1-2 sentence explanation of what it shows and why it matters.
- paperType: "math" for proof- or derivation-heavy papers, "ai-systems" for AI, ML and computer systems,
  "bio-medicine" for biology and medicine, "physics" for physics, else "other".
- oneLine: what the paper does, in one plain sentence.
- pronunciations: how to say this paper's tricky names out loud, for a voice that reads text: stylised
  spellings, digits used as letters, acronyms, model and dataset names (for example "GR00T" -> "Groot",
  "LLM" -> "L L M", "SoTA" -> "state of the art"), as people in the field say them: names normally said as a
  word stay a word (NVIDIA -> "Nvidia"). Only names in the paper a voice would likely get wrong; at most 15;
  [] if there are none.
Never invent content that is not in the paper.`;

export async function structurePaper(meta: PaperMeta, text: string, figures: Figure[], via: "latex" | "pdf"): Promise<Structure> {
  const client = new Anthropic();
  const figureList = figures.length
    ? figures.map((f) => `${f.id}: ${f.caption}`).join("\n")
    : "(no figures were extracted)";
  const user = `Title: ${meta.title}
Authors: ${meta.authors.join(", ")}

Figures extracted from the paper (id: caption):
${figureList}

The paper (${via === "latex" ? "LaTeX source" : "text extracted from the PDF"}):
<paper>
${text}
</paper>`;

  const stream = client.beta.messages.stream({
    model: STRUCTURE_MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The AI declined to read this paper.");
  if (msg.stop_reason === "max_tokens") throw new Error("The paper map was cut off (too long).");
  const out = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(out) as Omit<Structure, "theme" | "model" | "createdAt">;
  const known = new Set(figures.map((f) => f.id));
  console.log(
    `[structure] ${meta.id}: in ${msg.usage.input_tokens} out ${msg.usage.output_tokens} tokens (${msg.model})`,
  );
  return {
    ...parsed,
    figures: parsed.figures.filter((f) => known.has(f.id)),
    theme: themeFor(parsed.paperType),
    model: msg.model,
    createdAt: new Date().toISOString(),
  };
}
