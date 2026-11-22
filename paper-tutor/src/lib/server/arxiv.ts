import "server-only";
import { XMLParser } from "fast-xml-parser";
import { cached } from "./cache";
import type { PaperCard } from "@/lib/types";

// arXiv asks for at most 1 request every 3 seconds. Every arXiv call goes through this one queue, and every
// answer is cached, so the same thing is never fetched twice. (One queue per server process: on AWS with
// several instances this becomes a shared lock in DynamoDB.)
const GAP_MS = 3000;
const UA = "paper-tutor/0.1 (BULSHY.FM; open source)";

type QueueState = { tail: Promise<unknown>; last: number };
const g = globalThis as unknown as { __arxivQueue?: QueueState };
const queue: QueueState = (g.__arxivQueue ??= { tail: Promise.resolve(), last: 0 });

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.tail.then(async () => {
    const wait = queue.last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await job();
    } finally {
      queue.last = Date.now();
    }
  });
  queue.tail = run.catch(() => undefined);
  return run;
}

export class UpstreamError extends Error {
  status = 502;
}

async function arxivFetch(url: string): Promise<Response> {
  return enqueue(async () => {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new UpstreamError(`arXiv answered ${res.status} for ${new URL(url).pathname}`);
    return res;
  });
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

type AtomEntry = {
  id: string;
  title: string;
  summary: string;
  published: string;
  author: { name: string } | { name: string }[];
  category: { "@term": string } | { "@term": string }[];
};

function parseFeed(text: string): PaperCard[] {
  const feed = xml.parse(text)?.feed;
  return asArray<AtomEntry>(feed?.entry)
    .filter((e) => e && e.id && !String(e.id).includes("api/errors"))
    .map((e) => {
      const id = String(e.id).replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
      return {
        id,
        title: clean(e.title),
        authors: asArray(e.author).map((a) => clean(a.name)),
        abstract: clean(e.summary),
        published: e.published,
        categories: asArray(e.category).map((c) => c["@term"]),
      };
    });
}

const API = "https://export.arxiv.org/api/query";

export async function searchArxiv(q: string, start = 0): Promise<PaperCard[]> {
  const terms = q.trim().slice(0, 200);
  if (!terms) return [];
  // all: searches title, abstract and authors. Quote multi-word input as one phrase-ish AND query.
  const query = terms
    .split(/\s+/)
    .map((w) => `all:${w.replace(/[^\p{L}\p{N}\-]/gu, "")}`)
    .filter((w) => w !== "all:")
    .join("+AND+");
  if (!query) return [];
  const url = `${API}?search_query=${query}&start=${start}&max_results=25&sortBy=relevance`;
  return cached(`search:${url}`, 60 * 60_000, async () => parseFeed(await (await arxivFetch(url)).text()));
}

export async function browseArxiv(category: string, start = 0): Promise<PaperCard[]> {
  if (!/^[a-z-]+(\.[A-Za-z-]+)?$/.test(category)) return [];
  const url = `${API}?search_query=cat:${category}&start=${start}&max_results=25&sortBy=submittedDate&sortOrder=descending`;
  return cached(`browse:${url}`, 60 * 60_000, async () => parseFeed(await (await arxivFetch(url)).text()));
}

export async function arxivMeta(id: string): Promise<PaperCard | null> {
  const url = `${API}?id_list=${encodeURIComponent(id)}&max_results=1`;
  const list = await cached(`meta:${id}`, null, async () => parseFeed(await (await arxivFetch(url)).text()));
  return list[0] ?? null;
}

// The LaTeX source ("e-print"): a gzipped tar, or a single gzipped .tex, or (rarely) only a PDF.
export async function arxivSource(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const res = await arxivFetch(`https://arxiv.org/e-print/${id}`);
    return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
  } catch (e) {
    if (e instanceof UpstreamError) return null;
    throw e;
  }
}

export async function arxivPdf(id: string): Promise<Buffer> {
  const res = await arxivFetch(`https://arxiv.org/pdf/${id}`);
  return Buffer.from(await res.arrayBuffer());
}

export { CATEGORIES } from "@/lib/categories";
