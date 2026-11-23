import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { checkUrl, fetchPdf } from "./safeFetch";
import { fail, mb, step } from "./progress";
import { getStore } from "./store";
import { arxivMeta, arxivPdf, arxivSource } from "./arxiv";
import { readLatex, unpackSource } from "./latex";
import { pdfInfo, readPdf } from "./pdf";
import { fullMap, quickMap, type QuickMap } from "./structure";
import { useLimit, usePaperLimit } from "./limits";
import type { User } from "./auth";
import { isUploadId } from "@/lib/arxivId";
import type { Figure, Ingest, PaperMeta, PaperState, Structure } from "@/lib/types";

// Papers: metadata, reading (LaTeX source first, PDF as the fallback), and the AI structure pass.
// arXiv papers are shared by everyone; uploads are private to the person who uploaded them.

export const UPLOAD_MAX_BYTES = 40 * 1024 * 1024;
export const UPLOAD_MAX_PAGES = 150;
const MAX_TEXT_CHARS = 240_000; // ~60k tokens: a whole normal paper; very long reports are cut (appendices last)

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const dir = (id: string) => `papers/${id.replace("/", "_")}`;

export async function getMeta(id: string, user: User | null): Promise<PaperMeta> {
  const store = getStore();
  const saved = await store.getJSON<PaperMeta>(`${dir(id)}/meta.json`);
  if (isUploadId(id)) {
    // Uploads: only the owner. Anyone else gets the same answer as for a paper that doesn't exist.
    if (!saved || !user || saved.owner !== user.id) throw new HttpError(404, "Paper not found.");
    return saved;
  }
  if (saved) return saved;
  const card = await arxivMeta(id);
  if (!card) throw new HttpError(404, "No arXiv paper has that id.");
  const meta: PaperMeta = { ...card, source: "arxiv" };
  await store.putJSON(`${dir(id)}/meta.json`, meta);
  return meta;
}

export async function getState(id: string, user: User | null): Promise<PaperState> {
  const meta = await getMeta(id, user);
  const store = getStore();
  const [ingest, structure] = await Promise.all([
    store.getJSON<Ingest>(`${dir(id)}/ingest.json`),
    store.getJSON<Structure>(`${dir(id)}/structure.json`),
  ]);
  return { meta, ingest, structure };
}

// One read per paper at a time, even if several people press the button together.
const g = globalThis as unknown as { __inflight?: Map<string, Promise<unknown>> };
const inflight = (g.__inflight ??= new Map());
function once<T>(key: string, job: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = job().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Step 1 of reading: the text and the figure crops. Free (no AI), so the paper page can show figures early.
export async function ingestPaper(id: string, user: User | null): Promise<Ingest> {
  const meta = await getMeta(id, user);
  if (meta.pending) throw new HttpError(409, "The paper is still downloading.");
  const store = getStore();
  const existing = await store.getJSON<Ingest>(`${dir(id)}/ingest.json`);
  if (existing) return existing;

  return once(`ingest:${id}`, async () => {
    let via: Ingest["via"] = "pdf";
    let text = "";
    // The figures come second, in the background, so the text (and the AI work that needs it) never waits for
    // page rendering.
    let figureJob: () => Promise<{ caption: string; label?: string; png: Buffer; width: number; height: number }[]> = async () => [];

    if (meta.source === "arxiv") {
      step(id, "download", "active", "LaTeX source");
      const src = await arxivSource(id);
      if (src) step(id, "download", "done", `${mb(src.data.length)} MB`);
      const files = src ? await unpackSource(src.data) : null;
      step(id, "pages", "active", "LaTeX source");
      const latex = files ? await readLatex(files, { figures: false }) : null;
      if (latex && latex.text.length > 2000) {
        via = "latex";
        text = latex.text;
        step(id, "pages", "done", "LaTeX source");
        figureJob = async () => (await readLatex(files!, { onFigure: (n) => step(id, "figures", "active", `${n} found`) }))!.figures;
      }
    }
    if (via === "pdf") {
      if (meta.source === "arxiv") step(id, "download", "active", "PDF");
      const pdf = meta.source === "upload" ? await store.getBlob(`${dir(id)}/paper.pdf`) : await arxivPdf(id);
      if (!pdf) throw new HttpError(404, "The PDF is missing.");
      if (meta.source === "arxiv") step(id, "download", "done", `${mb(pdf.length)} MB`);
      step(id, "pages", "active");
      const read = await readPdf(pdf, { maxPages: UPLOAD_MAX_PAGES, figures: false, onPage: (n, total) => step(id, "pages", "active", `${n} / ${total}`) });
      step(id, "pages", "done", `${read.pages} pages`);
      text = read.text;
      figureJob = async () =>
        (await readPdf(pdf, { maxPages: UPLOAD_MAX_PAGES, onlyPages: read.captionPages, onFigure: (n) => step(id, "figures", "active", `${n} found`) })).figures;
    }
    if (text.length < 500) {
      fail(id, "Couldn't read any text from this paper (it may be scanned images).");
      throw new HttpError(422, "Couldn't read any text from this paper (it may be scanned images).");
    }

    const clipped = text.slice(0, MAX_TEXT_CHARS);
    await store.putBlob(`${dir(id)}/text.txt`, Buffer.from(clipped, "utf8"));
    const ingest: Ingest = { id, via, chars: clipped.length, figures: [], figuresPending: true, ingestedAt: new Date().toISOString() };
    await store.putJSON(`${dir(id)}/ingest.json`, ingest);

    step(id, "figures", "active", "0 found");
    void once(`figures:${id}`, async () => {
      try {
        const crops = await figureJob();
        const figures: Figure[] = [];
        for (const [i, c] of crops.entries()) {
          const fig: Figure = { id: `fig${i + 1}`, label: c.label, caption: c.caption, width: c.width, height: c.height };
          await store.putBlob(`${dir(id)}/figures/${fig.id}.png`, c.png);
          figures.push(fig);
        }
        await store.putJSON(`${dir(id)}/ingest.json`, { ...ingest, figures, figuresPending: false });
        step(id, "figures", "done", `${figures.length} found`);
      } catch (e) {
        console.error("[figures]", e);
        await store.putJSON(`${dir(id)}/ingest.json`, { ...ingest, figuresPending: false });
        step(id, "figures", "error", "couldn't crop them");
      }
    });
    return ingest;
  });
}

// Resolves when the figure crops are done (or at once if they already are).
export async function figuresReady(id: string): Promise<Ingest | null> {
  const running = inflight.get(`figures:${id}`);
  if (running) await running.catch(() => undefined);
  return getStore().getJSON<Ingest>(`${dir(id)}/ingest.json`);
}

// The quick map (seconds): what the paper does, its type, an outline, how to say its names. Saved; the overview
// waits for it and nothing else.
export async function getQuickMap(id: string, user: User | null): Promise<QuickMap> {
  const store = getStore();
  const key = `${dir(id)}/quickmap.json`;
  const saved = await store.getJSON<QuickMap>(key);
  if (saved) return saved;
  return once(`quickmap:${id}`, async () => {
    const meta = await getMeta(id, user);
    await ingestPaper(id, user);
    const text = (await store.getBlob(`${dir(id)}/text.txt`))?.toString("utf8") ?? "";
    step(id, "map", "active", "a first sketch");
    const q = await quickMap(meta, text);
    await store.putJSON(key, q);
    step(id, "map", "active", "sketch ready, mapping the sections");
    return q;
  });
}

// The full map (background): the paper in parallel chunks, merged. Needs sign-in; counts toward the daily "new
// papers" limit only when it runs.
export async function readPaper(id: string, user: User): Promise<PaperState> {
  const state = await getState(id, user);
  if (state.structure) return state;
  await ingestPaper(id, user);
  const structure = await once(`structure:${id}`, async () => {
    const store = getStore();
    const done = await store.getJSON<Structure>(`${dir(id)}/structure.json`);
    if (done) return done;
    await usePaperLimit(user.id, id);
    const quick = await getQuickMap(id, user);
    const ingest = (await figuresReady(id))!; // figure notes need the crops
    const text = (await store.getBlob(`${dir(id)}/text.txt`))?.toString("utf8") ?? "";
    const s = await fullMap(state.meta, text, ingest.figures, quick, (k, n) => step(id, "map", "active", `sections ${k} / ${n}`));
    await store.putJSON(`${dir(id)}/structure.json`, s);
    step(id, "map", "done", `${s.sections.length} sections`);
    return s;
  });
  return { ...(await getState(id, user)), structure };
}

export async function figurePng(id: string, figId: string, user: User | null): Promise<Buffer> {
  await getMeta(id, user); // access check for uploads
  if (!/^fig\d{1,3}$/.test(figId)) throw new HttpError(404, "No such figure.");
  const png = await getStore().getBlob(`${dir(id)}/figures/${figId}.png`);
  if (!png) throw new HttpError(404, "No such figure.");
  return png;
}

const newUploadId = () => `up_${randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x")}`;

async function checkPdf(data: Buffer): Promise<{ pages: number; title: string | null }> {
  if (data.length > UPLOAD_MAX_BYTES) throw new HttpError(413, `PDFs can be up to ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);
  if (data.subarray(0, 5).toString() !== "%PDF-") throw new HttpError(415, "That file isn't a PDF.");
  let info: { pages: number; title: string | null };
  try {
    info = await pdfInfo(data);
  } catch {
    throw new HttpError(422, "That PDF couldn't be opened.");
  }
  if (info.pages > UPLOAD_MAX_PAGES) throw new HttpError(413, `PDFs can have up to ${UPLOAD_MAX_PAGES} pages; this one has ${info.pages}.`);
  return info;
}

async function finishUpload(user: User, id: string, data: Buffer, fileName: string, sourceUrl?: string): Promise<PaperMeta> {
  const info = await checkPdf(data);
  const fromName = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  const meta: PaperMeta = {
    id,
    source: "upload",
    owner: user.id,
    // The title from page 1 (pdfInfo); the file name only when the PDF has no readable title at all.
    title: (info.title ?? (fromName || "Untitled PDF")).slice(0, 300),
    authors: [],
    abstract: "",
    pages: info.pages,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
  const store = getStore();
  await store.putBlob(`${dir(id)}/paper.pdf`, data);
  await store.putJSON(`${dir(id)}/meta.json`, meta);
  return meta;
}

export async function createUpload(user: User, data: Buffer, fileName: string): Promise<PaperMeta> {
  await checkPdf(data);
  await useLimit(user.id, "upload");
  const id = newUploadId();
  step(id, "download", "done", `${mb(data.length)} MB`);
  const meta = await finishUpload(user, id, data, fileName);
  void ingestPaper(id, user).catch((e) => console.error("[ingest]", e));
  return meta;
}

// A PDF from any https link: the paper page opens at once and shows the download; the file is fetched in the
// background, then it is private to that person like an upload. One import per person and link.
export async function createFromLink(user: User, link: string): Promise<PaperMeta> {
  const store = getStore();
  const key = `links/${user.id.replace(/[^A-Za-z0-9_-]/g, "")}/${createHash("sha256").update(link.trim()).digest("hex").slice(0, 32)}.json`;
  const known = await store.getJSON<{ id: string }>(key);
  if (known) {
    const meta = await store.getJSON<PaperMeta>(`${dir(known.id)}/meta.json`);
    if (meta && !meta.error) return meta;
  }
  const url = checkUrl(link.trim()); // bad links fail here, before anything is created
  await useLimit(user.id, "upload");
  const id = newUploadId();
  const meta: PaperMeta = { id, source: "upload", owner: user.id, title: "", authors: [], abstract: "", pending: true, sourceUrl: url.toString() };
  await store.putJSON(`${dir(id)}/meta.json`, meta);
  await store.putJSON(key, { id });
  step(id, "download", "active", "starting");
  void (async () => {
    try {
      const got = await fetchPdf(url.toString(), UPLOAD_MAX_BYTES, (n, total) =>
        step(id, "download", "active", total ? `${mb(n)} / ${mb(total)} MB` : `${mb(n)} MB`),
      );
      step(id, "download", "done", `${mb(got.data.length)} MB`);
      const name = decodeURIComponent(got.url.pathname.split("/").pop() || got.url.hostname);
      await finishUpload(user, id, got.data, name, got.url.toString());
      await ingestPaper(id, user); // start reading straight away
    } catch (e) {
      const message = (e as Error).message || "That link couldn't be opened.";
      fail(id, message);
      await store.putJSON(`${dir(id)}/meta.json`, { ...meta, pending: false, error: message });
    }
  })();
  return meta;
}
