import "server-only";
import { cached } from "./cache";
import type { PaperCard } from "@/lib/types";

// Today's popular AI papers, from Hugging Face Daily Papers (public API, no key). Cached for 30 minutes.
type HfItem = {
  paper: {
    id: string;
    title: string;
    summary: string;
    publishedAt: string;
    upvotes: number;
    authors: { name: string }[];
  };
  thumbnail?: string;
};

export async function trending(): Promise<PaperCard[]> {
  return cached("hf-daily", 30 * 60_000, async () => {
    const res = await fetch("https://huggingface.co/api/daily_papers?limit=50", {
      headers: { "User-Agent": "paper-tutor/0.1" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Hugging Face answered ${res.status}`);
    const items = (await res.json()) as HfItem[];
    return items
      .filter((i) => i.paper?.id && /^\d{4}\.\d{4,5}$/.test(i.paper.id))
      .map((i) => ({
        id: i.paper.id,
        title: i.paper.title.replace(/\s+/g, " ").trim(),
        authors: (i.paper.authors ?? []).map((a) => a.name),
        abstract: (i.paper.summary ?? "").replace(/\s+/g, " ").trim(),
        published: i.paper.publishedAt,
        upvotes: i.paper.upvotes ?? 0,
      }))
      .sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0));
  });
}
