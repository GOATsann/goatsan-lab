import "server-only";
import { cached } from "./cache";
import { getStore } from "./store";
import { spellings } from "./arxiv";
import type { PaperCard } from "@/lib/types";

// Semantic Scholar search: a second source that also knows papers outside arXiv (with a free PDF link when there
// is one). About one request per second without a key; answers are cached for an hour. A key, if set, goes in
// SEMANTIC_SCHOLAR_API_KEY.

const GAP_MS = 1100;
// The slot is reserved in the store (a conditional write in DynamoDB on AWS), so the gap holds across every
// server instance, not just this one.
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  return (async () => {
    const wait = await getStore().reserveSlot("rate/s2.json", GAP_MS);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return job();
  })();
}

type S2Paper = {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  publicationDate: string | null;
  authors: { name: string }[];
  externalIds: Record<string, string> | null;
  openAccessPdf: { url: string } | null;
  url: string;
};

async function s2Search(q: string): Promise<PaperCard[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=20&fields=title,abstract,year,publicationDate,authors,externalIds,openAccessPdf,url`;
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await enqueue(() =>
      fetch(url, { headers: { "User-Agent": "paper-tutor/0.1", ...(key ? { "x-api-key": key } : {}) }, signal: AbortSignal.timeout(15_000) }),
    );
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) throw new Error(`Semantic Scholar answered ${res.status}`);
    const d = (await res.json()) as { data?: S2Paper[] };
    return (d.data ?? []).map((p) => {
      const arxiv = p.externalIds?.ArXiv?.replace(/v\d+$/, "");
      return {
        id: arxiv ?? `s2_${p.paperId}`,
        title: p.title.replace(/\s+/g, " ").trim(),
        authors: (p.authors ?? []).map((a) => a.name),
        abstract: (p.abstract ?? "").replace(/\s+/g, " ").trim(),
        published: p.publicationDate ?? (p.year ? `${p.year}-01-01` : undefined),
        ...(arxiv ? {} : { pdfUrl: p.openAccessPdf?.url || undefined, link: p.url }),
      } satisfies PaperCard;
    });
  }
  return [];
}

export async function searchS2(q: string): Promise<PaperCard[]> {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  return cached(`s2:${query.toLowerCase()}`, 60 * 60_000, async () => {
    const first = await s2Search(query);
    if (first.length) return first;
    // Nothing: try the look-alike spelling ("groot" -> "gr00t").
    const alt = query.split(/\s+/).map((w) => spellings(w)[1] ?? w).join(" ");
    return alt.toLowerCase() !== query.toLowerCase() ? s2Search(alt) : [];
  });
}
