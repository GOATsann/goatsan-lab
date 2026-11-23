import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlockParam, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import type { DrawStep, Scene } from "@/lib/scenes/types";
import type { Figure } from "@/lib/types";
import { anthropicClient, LIVE_MODEL, sceneCleaner } from "./generate";
import { boardFromSteps, emptyBoard } from "./sanitize";

// The tutor as a small agent. One loop serves chat, deep dives and "Explain this": the model gets the paper
// (cached), a starting instruction, and two tools, and decides when to use them. show_on_video is offered only
// with "As video" on. Every tool input is validated, the loop is capped, and everything streams: text as it is
// written, scenes as the tool input is written. Citations are [[section]] markers in the text and "cite" fields
// on scenes, not a tool.

export type AgentPart = { text: string } | { video: true } | { scene: Scene } | { action: { type: "show_figure"; fig: string } };

export type ToolName = "show_on_video" | "show_figure";

const MAX_STEPS = 4; // model calls per turn (each tool round trip is one more)

const TOOLS: Record<ToolName, (maxScenes: number) => Anthropic.Tool> = {
  show_on_video: (maxScenes) => ({
    name: "show_on_video",
    description: `Explain on the whiteboard video, in 1 to ${maxScenes} scenes, in the scene format described in the system prompt. Use it when a visual explanation genuinely helps: how something works, a mechanism, a comparison, a diagram, an equation. Not for greetings, thanks, yes/no questions or short factual answers.`,
    input_schema: {
      type: "object",
      properties: {
        scenes: { type: "array", description: "Scene objects {say, draw, keep, cite}, exactly as the system prompt describes.", items: { type: "object" } },
      },
      required: ["scenes"],
    },
    eager_input_streaming: true,
  }),
  show_figure: () => ({
    name: "show_figure",
    description: "Open one of the paper's figures large for the viewer (a popup over the page). Use when the viewer asks to see a figure, or the real figure is the best answer.",
    input_schema: { type: "object", properties: { fig: { type: "string", description: 'A figure id from the figure list, like "fig3".' } }, required: ["fig"], additionalProperties: false },
    strict: true,
  }),
};

// Scene objects from the show_on_video input as it streams: each object in "scenes" is handed on when it closes.
function sceneObjects() {
  let buf = "";
  let pos = 0;
  let inArray = false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  return (chunk: string): unknown[] => {
    buf += chunk;
    const out: unknown[] = [];
    for (; pos < buf.length; pos++) {
      const c = buf[pos];
      if (!inArray) {
        const at = buf.indexOf('"scenes"');
        if (at < 0) return out;
        const open = buf.indexOf("[", at);
        if (open < 0) return out;
        inArray = true;
        pos = open;
        continue;
      }
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") {
        if (depth === 0) start = pos;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            out.push(JSON.parse(buf.slice(start, pos + 1)));
          } catch {}
          start = -1;
        }
      }
    }
    return out;
  };
}

export type AgentOpts = {
  label: string;
  system: TextBlockParam[];
  history: MessageParam[];
  instruction: string; // the starting instruction (a chat message, or "deep dive into...")
  images?: Anthropic.ContentBlockParam[]; // e.g. the figures it may show
  tools: ToolName[];
  maxScenes: number;
  figures: Figure[];
  sectionIds: Set<string>;
  board?: { say?: string; draw?: DrawStep[] }; // what the viewer is looking at (for video answers)
  stopAfterVideo?: boolean; // deep dives and explanations: done once the video is written
};

export async function* runAgent(o: AgentOpts): AsyncGenerator<AgentPart> {
  const client = anthropicClient();
  const tools = o.tools.map((t) => TOOLS[t](o.maxScenes));
  const cleaner = sceneCleaner({
    label: o.label,
    figures: o.figures,
    board: o.board?.draw?.length ? boardFromSteps(o.board.draw) : emptyBoard(),
    baseSteps: (o.board?.draw ?? []).slice(0, 60),
    sectionIds: o.sectionIds,
  });
  const messages: MessageParam[] = [
    ...o.history,
    { role: "user", content: [...(o.images ?? []), { type: "text", text: o.instruction }] },
  ];
  const figIds = new Set(o.figures.map((f) => f.id));
  let scenes = 0;
  let announced = false;
  const started = Date.now();
  const usage = { in: 0, cacheRead: 0, cacheWrite: 0, out: 0, steps: 0 };

  for (let step = 0; step < MAX_STEPS; step++) {
    usage.steps++;
    const lastStep = step === MAX_STEPS - 1;
    const stream = client.messages.stream({
      model: LIVE_MODEL,
      max_tokens: 12000,
      system: o.system,
      messages,
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      // On the last allowed step, no more tools: the model has to finish in text.
      ...(tools.length && !lastStep ? { tools, tool_choice: { type: "auto" as const } } : {}),
    });
    let current: string | null = null;
    let take = sceneObjects();
    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        current = ev.content_block.name;
        if (current === "show_on_video") {
          take = sceneObjects();
          if (!announced) {
            announced = true;
            yield { video: true };
          }
        }
      } else if (ev.type === "content_block_stop") {
        current = null;
      } else if (ev.type === "content_block_delta") {
        if (ev.delta.type === "text_delta") yield { text: ev.delta.text };
        else if (ev.delta.type === "input_json_delta" && current === "show_on_video") {
          for (const raw of take(ev.delta.partial_json)) {
            if (scenes >= o.maxScenes) break;
            const scene = await cleaner(raw);
            if (scene) {
              scenes++;
              yield { scene };
            }
          }
        }
      }
    }
    const msg = await stream.finalMessage();
    usage.in += msg.usage.input_tokens;
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;
    usage.out += msg.usage.output_tokens;
    if (msg.stop_reason === "refusal") {
      yield { text: "\n\nI can't help with that one." };
      break;
    }
    const calls = msg.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || !calls.length) break;
    if (o.stopAfterVideo && scenes > 0) break;

    // Run the tools (each input checked), then let the model continue.
    const results: ToolResultBlockParam[] = [];
    for (const call of calls) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      const fail = (m: string): ToolResultBlockParam => ({ type: "tool_result", tool_use_id: call.id, content: m, is_error: true });
      const ok = (m: string): ToolResultBlockParam => ({ type: "tool_result", tool_use_id: call.id, content: m });
      if (!o.tools.includes(call.name as ToolName)) {
        results.push(fail(`The tool ${call.name} isn't available.`));
      } else if (call.name === "show_on_video") {
        results.push(ok(scenes ? `Shown on the video (${scenes} scene${scenes > 1 ? "s" : ""}).` : "No valid scenes; nothing was shown."));
      } else if (call.name === "show_figure") {
        const fig = typeof input.fig === "string" ? input.fig : "";
        if (!figIds.has(fig)) results.push(fail(`No figure "${fig}". Use an id from the figure list.`));
        else {
          yield { action: { type: "show_figure", fig } };
          results.push(ok(`Opened ${fig} for the viewer.`));
        }
      }
    }
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: results });
  }
  console.log(
    `[agent] ${o.label} ${LIVE_MODEL}: ${usage.steps} step(s), ${scenes} scenes, in ${usage.in} (cache read ${usage.cacheRead}, write ${usage.cacheWrite}) out ${usage.out}, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
