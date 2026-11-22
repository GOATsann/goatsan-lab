import type { PaperMeta, Structure } from "@/lib/types";
import { attentionDemo } from "./demo-attention";
import type { SceneList } from "./types";

// Hand-written scene lists, by arXiv id. (From step 5 on, the AI writes overviews and they are cached.)
const HAND_WRITTEN: Record<string, SceneList> = {
  "1706.03762": attentionDemo,
};

export function overviewFor(id: string): SceneList | null {
  return HAND_WRITTEN[id] ?? null;
}

// Until a paper has an overview: a one-scene title card from what we already know (no AI involved).
export function titleCard(meta: PaperMeta, structure: Structure | null): SceneList {
  const firstSentence = meta.abstract.split(/(?<=\.)\s+/)[0] ?? "";
  const line = structure?.oneLine || firstSentence || "A paper waiting to be explained.";
  const authors = meta.authors.length > 3 ? `${meta.authors.slice(0, 3).join(", ")} and others` : meta.authors.join(", ");
  const year = meta.published ? new Date(meta.published).getFullYear() : null;
  const title = meta.title.length > 120 ? meta.title.slice(0, 117).replace(/\s+\S*$/, "") + "…" : meta.title;
  const long = title.length > 44;
  return {
    title: meta.title,
    paper: meta.source === "arxiv" ? meta.id : undefined,
    scenes: [
      {
        say: line,
        draw: [
          { t: "title", text: title, y: long ? 170 : 260, size: long ? 64 : 80, sub: [authors, year].filter(Boolean).join(", "), s: 0 },
          { t: "text", text: line, x: 800, y: 600, w: 1200, size: 36, ink: "muted", align: "center", s: 0 },
        ],
      },
    ],
  };
}
