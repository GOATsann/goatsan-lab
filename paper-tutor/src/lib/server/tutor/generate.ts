import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { getStore } from "../store";
import type { DrawStep, Scene } from "@/lib/scenes/types";
import { layoutScene } from "@/lib/scenes/layout";
import type { Figure } from "@/lib/types";
import { resolvePictures, sanitizeScene, type BoardState } from "./sanitize";
import { findIcon } from "../iconify";

// Claude writes scenes, one JSON object per line, and each line is checked and handed on the moment it is
// complete, so the player can draw scene 1 while scene 2 is still being written.

export const LIVE_MODEL = "claude-sonnet-5-5"; // live scenes and chat: better judgment, still quick
export const CHECK_MODEL = "claude-haiku-5-5"; // small fast checks: numbers, question or small talk
export const OVERVIEW_MODEL = "claude-opus-5-5"; // the cached 60-second overview: the strongest model

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());
export const anthropicClient = anthropic;

export type Usage = { input: number; cacheRead: number; cacheWrite: number; output: number; model: string };

export function systemBlocks(rules: string, paper: string): TextBlockParam[] {
  // Two stable blocks; the cache breakpoint after the paper covers both.
  return [
    { type: "text", text: rules },
    { type: "text", text: paper, cache_control: { type: "ephemeral" } },
  ];
}

function logUsage(label: string, u: Usage, ms: number) {
  console.log(
    `[tutor] ${label} ${u.model}: in ${u.input} (cache read ${u.cacheRead}, write ${u.cacheWrite}) out ${u.output}, ${(ms / 1000).toFixed(1)}s`,
  );
}

type GenOpts = {
  label: string;
  model: string;
  system: TextBlockParam[];
  messages: MessageParam[];
  figures: Figure[];
  board: BoardState;
  baseSteps?: DrawStep[]; // what is on the board already (for a first scene that keeps it)
  speak?: (line: string) => string; // rewrites a spoken line for the ear (names as pronounced)
  sectionIds?: Set<string>;
  maxScenes: number;
};

// Every scene, however it was written (a line of text or a tool input), is checked, gets its pictures looked up,
// and gets the layout checks, against what is already on the board.
export function sceneCleaner(o: Pick<GenOpts, "label" | "figures" | "board" | "baseSteps" | "sectionIds" | "speak">) {
  const figSizes = Object.fromEntries(o.figures.map((f) => [f.id, f]));
  let base: DrawStep[] = o.baseSteps ?? [];
  return async (raw: unknown): Promise<Scene | null> => {
    let clean = sanitizeScene(raw, o.figures, o.board, o.sectionIds);
    if (!clean) return null;
    if (o.speak) clean = { ...clean, say: o.speak(clean.say) };
    clean = await resolvePictures(clean, findIcon);
    // Layout checks: nudge overlaps apart, re-route arrows that would cross text.
    const laid = layoutScene(clean, { base: clean.keep ? base : [], figures: figSizes });
    if (laid.issues.length) console.log(`[layout] ${o.label}: ${laid.issues.join("; ")}`);
    base = clean.keep ? [...base, ...laid.scene.draw] : laid.scene.draw;
    return laid.scene;
  };
}

// Yields clean scenes as Claude finishes each line.
export async function* generateScenes(o: GenOpts): AsyncGenerator<Scene> {
  const started = Date.now();
  const params = {
    model: o.model,
    max_tokens: 16000,
    system: o.system,
    messages: o.messages,
  };
  // Opus 5.5 always thinks: keep it light. Haiku: thinking off, for the fastest first scene.
  const stream =
    o.model.startsWith("claude-opus")
      ? anthropic().beta.messages.stream({
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
        })
      : anthropic().messages.stream({ ...params, thinking: { type: "between_tools" }, output_config: { effort: "low" } });

  let buf = "";
  let count = 0;
  let firstAt = 0;
  const clean = sceneCleaner(o);
  const take = async (line: string): Promise<Scene | null> => {
    const t = line.trim().replace(/^```(json)?$/, "");
    if (!t.startsWith("{")) return null;
    try {
      return await clean(JSON.parse(t));
    } catch {
      return null;
    }
  };
  for await (const ev of stream as AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>) {
    if (ev.type !== "content_block_delta" || ev.delta?.type !== "text_delta") continue;
    buf += ev.delta.text ?? "";
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const scene = await take(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (scene && count < o.maxScenes) {
        if (!count) firstAt = Date.now() - started;
        count++;
        yield scene;
      }
    }
  }
  const last = await take(buf);
  if (last && count < o.maxScenes) {
    if (!count) firstAt = Date.now() - started;
    count++;
    yield last;
  }
  const msg = await (stream as unknown as { finalMessage(): Promise<Anthropic.Message> }).finalMessage();
  if (msg.stop_reason === "refusal" && !count) throw new Error("The tutor declined this request.");
  logUsage(
    `${o.label} (${count} scenes, first after ${(firstAt / 1000).toFixed(1)}s)`,
    {
      model: msg.model,
      input: msg.usage.input_tokens,
      cacheRead: msg.usage.cache_read_input_tokens ?? 0,
      cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
      output: msg.usage.output_tokens,
    },
    Date.now() - started,
  );
}

// ---- cached scene lists, shared while being written ----
// If two people ask for the same uncached overview or deep dive at once, the second one follows the first one's
// stream instead of paying for a second copy. When it finishes, the list is saved and replayed for everyone.

export type SavedScenes = { scenes: Scene[]; model: string; createdAt: string; theme?: string };

type Live = { scenes: Scene[]; done: boolean; error: string | null; wake: Set<() => void> };
const g = globalThis as unknown as { __liveScenes?: Map<string, Live> };
const live = (g.__liveScenes ??= new Map());

export async function savedScenes(key: string): Promise<SavedScenes | null> {
  return getStore().getJSON<SavedScenes>(key);
}

export function isLive(key: string) {
  return live.has(key);
}

// Start (or join) the job that writes the list saved at `key`.
export function sharedScenes(
  key: string,
  start: () => AsyncGenerator<Scene>,
  meta: { model: string; theme?: string },
  onDone?: (scenes: Scene[]) => void,
): AsyncGenerator<Scene> {
  let job = live.get(key);
  if (!job) {
    const j: Live = { scenes: [], done: false, error: null, wake: new Set() };
    job = j;
    live.set(key, j);
    const ping = () => {
      for (const w of j.wake) w();
    };
    void (async () => {
      try {
        for await (const s of start()) {
          j.scenes.push(s);
          ping();
        }
        if (j.scenes.length) {
          await getStore().putJSON(key, { scenes: j.scenes, model: meta.model, theme: meta.theme, createdAt: new Date().toISOString() });
          onDone?.(j.scenes);
        } else {
          j.error = "The tutor didn't write any scenes. Try again.";
        }
      } catch (e) {
        console.error(e);
        j.error = (e as Error).message || "The tutor stopped.";
      } finally {
        j.done = true;
        live.delete(key);
        ping();
      }
    })();
  }
  const follow = job;
  return (async function* () {
    let i = 0;
    for (;;) {
      while (i < follow.scenes.length) yield follow.scenes[i++];
      if (follow.done) {
        if (follow.error && i === 0) throw new Error(follow.error);
        return;
      }
      await new Promise<void>((r) => {
        const w = () => {
          follow.wake.delete(w);
          r();
        };
        follow.wake.add(w);
      });
    }
  })();
}
