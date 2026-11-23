import type { PaperMeta, Structure } from "@/lib/types";
import { attentionDemo } from "./demo-attention";
import { layoutScenes } from "./layout";
import type { SceneList } from "./types";

// Hand-written scene lists, by arXiv id. (From step 5 on, the AI writes overviews and they are cached.)
const HAND_WRITTEN: Record<string, SceneList> = {
  "1706.03762": attentionDemo,
};

export function handWritten(id: string): SceneList | null {
  const list = HAND_WRITTEN[id];
  return list ? { ...list, scenes: layoutScenes(list.scenes).scenes } : null;
}

// Before a paper's overview exists: its title, shown behind the play button (no AI involved).
export function titleCard(meta: PaperMeta, _structure?: Structure | null): SceneList {
  const authors = meta.authors.length > 2 ? `${meta.authors[0]} and others` : meta.authors.join(" and ");
  const year = meta.published ? new Date(meta.published).getFullYear() : null;
  // No title yet (a link still downloading): a neutral card, never the file name.
  if (!meta.title) return { title: "Reading the paper…", scenes: [{ say: "Reading the paper.", draw: [{ t: "title", text: "Reading the paper…", y: 320, size: 72, s: 0 }] }] };
  const title = meta.title.length > 100 ? meta.title.slice(0, 97).replace(/\s+\S*$/, "") + "…" : meta.title;
  const long = title.length > 44;
  return {
    title: meta.title,
    paper: meta.source === "arxiv" ? meta.id : undefined,
    scenes: [
      {
        say: `${meta.title.replace(/:/g, ",")}.`,
        draw: [{ t: "title", text: title, y: long ? 260 : 320, size: long ? 64 : 84, sub: [authors, year].filter(Boolean).join(", ") || undefined, s: 0 }],
      },
    ],
  };
}
