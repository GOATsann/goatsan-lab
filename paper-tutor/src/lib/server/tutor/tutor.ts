import "server-only";
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { getStore } from "../store";
import { getState, HttpError, ingestPaper, readPaper } from "../papers";
import { useLimit, usePaperLimit } from "../limits";
import { speak } from "../tts";
import type { User } from "../auth";
import { splitSentences, type DrawStep, type Scene } from "@/lib/scenes/types";
import { themeFor, type Figure, type PaperMeta, type Structure, type ThemeName } from "@/lib/types";
import { paperContext, SCENE_RULES } from "./prompt";
import { emptyBoard } from "./sanitize";
import { pronunciations, speakable } from "./say";
import { checkedInOrder, checkNumbers } from "./verify";
import { generateScenes, isLive, LIVE_MODEL, OVERVIEW_MODEL, savedScenes, sharedScenes, systemBlocks } from "./generate";
import { runAgent, type AgentPart, type ToolName } from "./agent";

// The live tutor: the 60-second overview (written once by the strongest model, then replayed for everyone),
// deep dives, "Explain this", and chat answers on the whiteboard or as text.

const dir = (id: string) => `papers/${id.replace("/", "_")}`;
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "x";

export function themeForPaper(meta: PaperMeta, structure: Structure | null): ThemeName {
  if (structure) return structure.theme;
  const cats = meta.categories ?? [];
  if (cats.some((c) => c.startsWith("q-bio"))) return "illustrated";
  if (cats.some((c) => /^(math|physics|quant-ph|astro-ph|hep|gr-qc|cond-mat|nucl)/.test(c)) && !cats.some((c) => c.startsWith("cs."))) {
    return themeFor("math");
  }
  return "diagram";
}

async function context(id: string, user: User | null) {
  const state = await getState(id, user);
  const ingest = state.ingest ?? (await ingestPaper(id, user));
  const text = (await getStore().getBlob(`${dir(id)}/text.txt`))?.toString("utf8") ?? "";
  const say = await pronunciations(dir(id), state.meta, state.structure, text);
  const system = systemBlocks(SCENE_RULES, paperContext(state.meta, ingest, text, state.structure, say));
  const sectionIds = new Set(state.structure?.sections.map((s) => s.id) ?? []);
  const speak = (line: string) => speakable(line, say);
  return { ...state, ingest, system, sectionIds, speak };
}

// The paper's figures as images, so the tutor can see them (to judge which are simple, and what to crop).
async function figureImages(id: string, figs: Figure[]): Promise<ContentBlockParam[]> {
  const store = getStore();
  const out: ContentBlockParam[] = [];
  for (const f of figs) {
    const png = await store.getBlob(`${dir(id)}/figures/${f.id}.png`);
    if (!png || png.length > 4_500_000) continue;
    out.push({ type: "text", text: `Figure ${f.id}:` });
    out.push({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
  }
  return out;
}

// ---- the overview ----

const overviewKey = (id: string) => `${dir(id)}/overview.json`;

// The first scene is made here, instantly, from what we already know, so the board and the voice start at once
// while the AI writes the rest.
function opener(meta: PaperMeta): Scene {
  const authors = meta.authors.length > 2 ? `${meta.authors[0]} and others` : meta.authors.join(" and ");
  const year = meta.published ? new Date(meta.published).getFullYear() : null;
  const title = meta.title.length > 100 ? meta.title.slice(0, 97).replace(/\s+\S*$/, "") + "…" : meta.title;
  const long = title.length > 44;
  // Say the short name when the title has one ("GROOT-2: Weakly Supervised..." -> "GROOT-2").
  const short = meta.title.includes(":") && meta.title.indexOf(":") <= 40 ? meta.title.slice(0, meta.title.indexOf(":")) : meta.title;
  const spoken = short.replace(/\s+/g, " ").trim();
  // A long title is on the board already; reading it all out would be slow.
  const intro =
    spoken.split(" ").length > 9
      ? `A paper${year ? ` from ${year}` : ""}${authors ? ` by ${authors}` : ""}.`
      : `${spoken}${authors ? `, by ${authors}${year ? `, ${year}` : ""}` : ""}.`;
  return {
    say: `${intro} Here is the idea in about a minute.`,
    draw: [{ t: "title", id: "title", text: title, y: long ? 260 : 320, size: long ? 64 : 84, sub: [authors, year].filter(Boolean).join(", "), s: 0 }],
  };
}

// Re-run the numbers check over a saved overview and save the corrected version (used for overviews written
// before the check existed).
export async function recheckOverview(id: string, user: User | null): Promise<{ before: string[]; after: string[] } | null> {
  const ctx = await context(id, user);
  const saved = await savedScenes(overviewKey(id));
  if (!saved) return null;
  const [first, ...rest] = saved.scenes;
  const fixed = await Promise.all(rest.map((sc) => checkNumbers(sc, ctx.system, `recheck ${id}`)));
  const scenes = [first, ...fixed];
  await getStore().putJSON(overviewKey(id), { ...saved, scenes });
  return { before: saved.scenes.map((s) => s.say), after: scenes.map((s) => s.say) };
}

export async function cachedOverview(id: string, user: User | null) {
  await getState(id, user); // access check for uploads
  const saved = await savedScenes(overviewKey(id));
  if (!saved) return null;
  const ctx = await context(id, user);
  return { ...saved, scenes: saved.scenes.map((sc) => ({ ...sc, say: ctx.speak(sc.say) })) };
}

// One writer per overview: while the first request is still checking limits and loading the paper, others wait
// for it and then join its stream (or read the saved result), so two tabs or two people never pay twice.
const g = globalThis as unknown as { __ovStarting?: Map<string, Promise<void>> };
const starting = (g.__ovStarting ??= new Map());

const replay = (saved: { scenes: Scene[] }, speak: (s: string) => string) =>
  (async function* () {
    for (const sc of saved.scenes) yield { ...sc, say: speak(sc.say) };
  })();

export async function overview(id: string, user: User | null, opts: { voice: boolean }) {
  const key = overviewKey(id);
  const ctx = await context(id, user); // also the access check for uploads
  const theme = themeForPaper(ctx.meta, ctx.structure);
  const waiting = starting.get(key);
  if (waiting) await waiting.catch(() => undefined);
  const saved = await savedScenes(key);
  if (saved) return { theme, cached: true, scenes: replay(saved, ctx.speak) };
  if (!isLive(key)) {
    if (!user) throw new HttpError(401, "Sign in to make this paper's overview.");
    let release = () => {};
    starting.set(key, new Promise<void>((r) => (release = r)));
    try {
      await usePaperLimit(user.id, id);
    } catch (e) {
      starting.delete(key);
      release();
      throw e;
    }
    // Map the paper at the same time (deep dives and chat use the map); it counts as the same new paper.
    if (!ctx.structure) void readPaper(id, user).catch((e) => console.error("[structure]", e));
    const out = startOverview(id, ctx, theme, opts);
    starting.delete(key);
    release();
    return out;
  }
  return startOverview(id, ctx, theme, opts); // joins the stream already being written
}

function startOverview(id: string, ctx: Awaited<ReturnType<typeof context>>, theme: ThemeName, opts: { voice: boolean }) {
  const op = opener(ctx.meta);
  const first = { ...op, say: ctx.speak(op.say) };
  const scenes = sharedScenes(
    overviewKey(id),
    async function* () {
      yield first; // instant, and nothing in it to check
      const written = generateScenes({
        label: `overview ${id}`,
        model: OVERVIEW_MODEL,
        system: ctx.system,
        messages: [
          {
            role: "user",
            content: [
              ...(await figureImages(id, ctx.ingest.figures.slice(0, 8))),
              {
                type: "text",
                text: `Write this paper's 60-second overview for the whiteboard.
The app already shows the opening scene, so do not repeat it: it says "${first.say}" over the paper's title.
Write exactly 5 more scenes. The whole overview must take about 60 seconds of voice, so each scene says 14 to 18
words (never more than 20): about 85 spoken words in total. The arc: the problem the paper tackles, the key idea,
how it works (a simple redraw of the method with icons, boxes and arrows, or the key equation with highlights),
the main result with real numbers from the paper (a plot when there is a results table), and what it means.
Every scene needs a picture. Prefer simple redraws over the paper's figures: use at most one real figure, and only
if it is simple or cropped to the part that matters. The paper's figures are attached so you can see them. Start with the first JSON line right away.`,
              },
            ],
          },
        ],
        figures: ctx.ingest.figures,
        board: emptyBoard(),
        sectionIds: ctx.sectionIds,
        speak: ctx.speak,
        maxScenes: 8,
      });
      // Numbers check against the paper before a scene is shown or saved.
      yield* checkedInOrder(written, (sc) => checkNumbers(sc, ctx.system, `overview ${id}`));
    },
    { model: OVERVIEW_MODEL, theme },
    (all) => {
      // Make the voice once, so everyone who replays the overview hears it (even before signing in).
      if (opts.voice) void prewarmVoice(all);
    },
  );
  return { theme, cached: false, scenes };
}

async function prewarmVoice(scenes: Scene[]) {
  for (const s of scenes) {
    for (const line of splitSentences(s.say)) {
      try {
        await speak(line, "coral");
      } catch (e) {
        console.error("[tts prewarm]", (e as Error).message);
        return;
      }
    }
  }
}

// ---- deep dives and "Explain this" ----

export type LiveRequest = { mode: "deepdive"; section: string } | { mode: "explain"; eq?: string; fig?: string };

export async function liveScenes(id: string, user: User | null, req: LiveRequest) {
  const ctx = await context(id, user);
  const theme = themeForPaper(ctx.meta, ctx.structure);

  if (!ctx.structure) throw new HttpError(409, "Map this paper first.");
  let key: string;
  let task: string;
  let maxScenes: number;
  let figs: Figure[] = [];
  if (req.mode === "deepdive") {
    const sec = ctx.structure.sections.find((s) => s.id === req.section);
    if (!sec) throw new HttpError(404, "No such section.");
    key = `${dir(id)}/scenes/deepdive-${safe(sec.id)}.json`;
    maxScenes = 8;
    const inSection = new Set(ctx.structure.figures.filter((f) => f.section === sec.id).map((f) => f.id));
    figs = ctx.ingest.figures.filter((f) => inSection.has(f.id)).slice(0, 4);
    task = `Deep dive into the section "${sec.title}" (id ${sec.id}). Write 5 to 7 scenes, 140 to 190 spoken words in
total (60 to 90 seconds). Explain what this section does and why, step by step: first with simple pictures (icons,
boxes and arrows, sketches) and its equations (highlight the parts as you explain them). If the section has a
figure, end with a scene that shows the real figure from the paper ("here is the real figure from the paper"),
after the simple version has explained it; viewers can click it to open it large. The viewer has seen the
overview, so go further. Cite "${sec.id}".`;
  } else if (req.eq) {
    const eq = ctx.structure.equations.find((e) => e.id === req.eq);
    if (!eq) throw new HttpError(404, "No such equation.");
    key = `${dir(id)}/scenes/explain-${safe(eq.id)}.json`;
    maxScenes = 3;
    task = `Explain this equation from the paper in 2 or 3 scenes, 50 to 80 spoken words in total (20 to 30 seconds):
${eq.tex}
Write it on the board with \\term marks and highlight each part as you explain it: what the symbols mean, what it
computes, and why it matters in the paper. Cite "${eq.section}".`;
  } else if (req.fig) {
    const fig = ctx.ingest.figures.find((f) => f.id === req.fig);
    if (!fig) throw new HttpError(404, "No such figure.");
    key = `${dir(id)}/scenes/explain-${safe(fig.id)}.json`;
    maxScenes = 3;
    figs = [fig];
    task = `Explain figure ${fig.id} ("${fig.caption.slice(0, 300)}") in 2 or 3 scenes, 50 to 80 spoken words in total
(20 to 30 seconds). First explain what it shows with a simple redraw (icons, boxes, arrows), then show the real
figure, cropped or zoomed (camera) to the part you talk about. Say why it matters. Cite the section it belongs to.`;
  } else {
    throw new HttpError(400, "Explain what?");
  }

  const saved = await savedScenes(key);
  if (saved) return { theme, cached: true, scenes: replay(saved, ctx.speak) };
  if (!isLive(key)) {
    if (!user) throw new HttpError(401, "Sign in for deep dives and explanations.");
    await useLimit(user.id, "deepdive");
  }
  // The same tutor agent as chat, with a starting instruction and the video tool; its scenes are saved.
  const images = await figureImages(id, figs);
  const scenes = sharedScenes(
    key,
    async function* () {
      for await (const part of runAgent({
        label: `${req.mode} ${id}`,
        system: ctx.system,
        history: [],
        instruction: `${task}${figs.length ? "\nThe figures you may show are attached." : ""}
Put the explanation on the video with show_on_video (all its scenes in one call). Keep any written text to one
short sentence.`,
        images,
        tools: ["show_on_video"],
        stopAfterVideo: true,
        speak: ctx.speak,
        maxScenes,
        figures: ctx.ingest.figures,
        sectionIds: ctx.sectionIds,
      })) {
        if ("scene" in part) yield part.scene;
      }
    },
    { model: LIVE_MODEL, theme },
  );
  return { theme, cached: false, scenes };
}

function history(h: { role: "user" | "assistant"; text: string }[] | undefined): MessageParam[] {
  const turns = (h ?? []).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim()).slice(-8);
  // The API needs alternating turns that start with the user.
  const out: MessageParam[] = [];
  for (const t of turns) {
    const text = t.text.slice(0, 2000);
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content}\n\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

// ---- chat ----
// Every message is one agent turn, always answered in text. The tutor decides which tools to use: with "As video"
// on it may show the answer on the board (show_on_video); it can open a figure or a section for the viewer, search
// the paper to check wording, and cite sections. A greeting or a yes/no question gets text only.

export async function chatTurn(
  id: string,
  user: User | null,
  req: { question: string; history: { role: "user" | "assistant"; text: string }[]; video: boolean; board?: { say?: string; draw?: DrawStep[] } },
): Promise<AsyncGenerator<AgentPart>> {
  if (!user) throw new HttpError(401, "Sign in to ask the tutor.");
  const question = req.question.trim().slice(0, 600);
  if (!question) throw new HttpError(400, "Ask a question.");
  const ctx = await context(id, user);
  await useLimit(user.id, "chat");
  const boardText =
    req.video && req.board?.draw?.length
      ? `The board the viewer is looking at. Narration: "${(req.board.say ?? "").slice(0, 400)}"
Board steps (ids a video answer can point at, highlight or erase): ${JSON.stringify(req.board.draw).slice(0, 6000)}

`
      : "";
  const tools: ToolName[] = req.video ? ["show_on_video", "show_figure"] : ["show_figure"];
  return runAgent({
    label: `chat ${id}`,
    system: ctx.system,
    history: history(req.history),
    instruction: `${boardText}The viewer says: ${question}

Reply in plain text: short and direct, 1 to 3 short paragraphs (a greeting or thanks gets one friendly sentence).
After each claim from the paper, cite its section as [[section-id]] (or [[Section title]] if there is no map).
If the paper doesn't say, say so.${
      req.video
        ? ` When the viewer asks how or why something works (a method, mechanism, equation, result or comparison), also
show it with show_on_video and keep the text to a short summary; its first scene may set "keep": true to add to
the board above. Greetings, thanks, yes/no and one-fact questions get text only.`
        : ""
    }`,
    tools,
    maxScenes: 3,
    speak: ctx.speak,
    figures: ctx.ingest.figures,
    sectionIds: ctx.sectionIds,
    board: req.video ? req.board : undefined,
  });
}
