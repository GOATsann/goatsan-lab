import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import type { Scene } from "@/lib/scenes/types";
import { LIVE_MODEL } from "./generate";

// A numbers check for overview scenes: every number and quantity a scene says or draws is compared with the
// paper (same cached prompt), and anything that doesn't match, including rounding that changes the meaning
// ("over four and a half hours" for 261 minutes), is corrected before the scene is shown or saved.

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

// Only scenes that state a quantity need checking.
const QUANTITY =
  /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|third|double|twice|triple|percent|times)\b/i;

function texts(scene: Scene): string {
  const parts = [scene.say];
  for (const st of scene.draw) {
    if (st.t === "text" || st.t === "title") parts.push(st.text);
    if (st.t === "box" && st.text) parts.push(st.text);
    if (st.t === "steps") parts.push(...st.items);
    if (st.t === "plot") parts.push(`${st.labels.join(", ")} = ${st.values.join(", ")}`);
    if (st.t === "highlight" && st.note) parts.push(st.note);
    if ((st.t === "icon" || st.t === "sketch") && st.label) parts.push(st.label);
  }
  return parts.join("\n");
}

type Fix = { find: string; replace: string; why: string };

const SCHEMA = {
  type: "object",
  properties: {
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: { find: { type: "string" }, replace: { type: "string" }, why: { type: "string" } },
        required: ["find", "replace", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["fixes"],
  additionalProperties: false,
};

// Replace text in every string of the scene, and numbers equal to `find` in plot values.
function apply(scene: Scene, fixes: Fix[]): Scene {
  let out = JSON.parse(JSON.stringify(scene)) as Scene;
  for (const f of fixes) {
    if (!f.find || f.find === f.replace) continue;
    const walk = (v: unknown): unknown => {
      if (typeof v === "string") return v.split(f.find).join(f.replace);
      if (typeof v === "number" && String(v) === f.find && Number.isFinite(Number(f.replace))) return Number(f.replace);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "t" || k === "id" || k === "fig" || k === "svg" ? x : walk(x)]));
      return v;
    };
    out = walk(out) as Scene;
  }
  return out;
}

export async function checkNumbers(scene: Scene, system: TextBlockParam[], label: string): Promise<Scene> {
  const content = texts(scene);
  if (!QUANTITY.test(content)) return scene;
  try {
    const msg = await anthropic().messages.create({
      model: LIVE_MODEL,
      max_tokens: 2000,
      system,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Fact-check the numbers in this whiteboard scene against the paper. Check every number, percentage,
duration, count and comparison, written in digits or words. Flag a figure if the paper's value differs, or if
rounding or a word like "over", "about", "almost" or "more than" makes it untrue (for example "over four and a half
hours" when the paper says 261 to 289 minutes). For each problem give "find": the exact wrong text as it appears
below, and "replace": the corrected text, short and in the same style (spoken words stay spoken words). Return an
empty list when everything matches. Flag only real errors: a value the paper contradicts, or a qualifier or
rounding that makes the statement false. Never flag the same value written another way (units spelled out,
"fifteen microns" for 15 µm) or honest rounding ("about forty minutes" for 36 to 46 minutes). Never add extra facts or clarifications; only
correct what is wrong.

Scene:
${content}`,
        },
      ],
    });
    const out = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    // Corrections only: drop "fixes" that keep the original and just add to it, or that change nothing.
    const fixes = (JSON.parse(out) as { fixes: Fix[] }).fixes.filter(
      (f) =>
        f.find &&
        content.includes(f.find) &&
        f.replace.trim() !== f.find.trim() &&
        !f.replace.toLowerCase().includes(f.find.toLowerCase()) &&
        f.replace.length <= f.find.length + 40,
    );
    console.log(
      `[numbers] ${label}: ${fixes.length ? fixes.map((f) => `"${f.find}" -> "${f.replace}" (${f.why})`).join("; ") : "ok"} (in ${msg.usage.input_tokens}, cache ${msg.usage.cache_read_input_tokens ?? 0})`,
    );
    return fixes.length ? apply(scene, fixes) : scene;
  } catch (e) {
    console.error("[numbers] check failed:", (e as Error).message);
    return scene; // the check is a safety net; never block the tutor on it
  }
}

// Check scenes as they stream, in parallel, but hand them on in order.
export async function* checkedInOrder(scenes: AsyncGenerator<Scene>, check: (s: Scene) => Promise<Scene>): AsyncGenerator<Scene> {
  const pending: Promise<Scene>[] = [];
  let done = false;
  let failure: unknown = null;
  const sig = { wake: null as (() => void) | null };
  void (async () => {
    try {
      for await (const s of scenes) {
        pending.push(check(s));
        sig.wake?.();
      }
    } catch (e) {
      failure = e;
    } finally {
      done = true;
      sig.wake?.();
    }
  })();
  let i = 0;
  for (;;) {
    if (i < pending.length) {
      yield await pending[i++];
      continue;
    }
    if (done) {
      if (failure && i === 0) throw failure;
      return;
    }
    await new Promise<void>((r) => (sig.wake = r));
    sig.wake = null;
  }
}
