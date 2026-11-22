import "server-only";
import { randomBytes } from "node:crypto";
import { getStore } from "./store";
import { arxivMeta, arxivPdf, arxivSource } from "./arxiv";
import { readLatex, unpackSource } from "./latex";
import { pdfInfo, readPdf } from "./pdf";
import { structurePaper } from "./structure";
import { useLimit } from "./limits";
import type { User } from "./auth";
import { isUploadId } from "@/lib/arxivId";
import type { Figure, Ingest, PaperMeta, PaperState, Structure } from "@/lib/types";

// Papers: metadata, reading (LaTeX source first, PDF as the fallback), and the AI structure pass.
// arXiv papers are shared by everyone; uploads are private to the person who uploaded them.

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const UPLOAD_MAX_PAGES = 60;
const MAX_TEXT_CHARS = 400_000; // ~100k tokens: plenty for a normal paper

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
  const store = getStore();
  const existing = await store.getJSON<Ingest>(`${dir(id)}/ingest.json`);
  if (existing) return existing;

  return once(`ingest:${id}`, async () => {
    let via: Ingest["via"] = "pdf";
    let text = "";
    let crops: { caption: string; label?: string; png: Buffer; width: number; height: number }[] = [];

    if (meta.source === "arxiv") {
      const src = await arxivSource(id);
      const files = src ? await unpackSource(src.data) : null;
      const latex = files ? await readLatex(files) : null;
      if (latex && latex.text.length > 2000) {
        via = "latex";
        text = latex.text;
        crops = latex.figures;
      }
    }
    if (via === "pdf") {
      const pdf = meta.source === "upload" ? await store.getBlob(`${dir(id)}/paper.pdf`) : await arxivPdf(id);
      if (!pdf) throw new HttpError(404, "The PDF is missing.");
      const read = await readPdf(pdf, { maxPages: UPLOAD_MAX_PAGES });
      text = read.text;
      crops = read.figures;
    }
    if (text.length < 500) throw new HttpError(422, "Couldn't read any text from this paper (it may be scanned images).");

    const figures: Figure[] = [];
    for (const [i, c] of crops.entries()) {
      const fig: Figure = { id: `fig${i + 1}`, label: c.label, caption: c.caption, width: c.width, height: c.height };
      await store.putBlob(`${dir(id)}/figures/${fig.id}.png`, c.png);
      figures.push(fig);
    }
    const clipped = text.slice(0, MAX_TEXT_CHARS);
    await store.putBlob(`${dir(id)}/text.txt`, Buffer.from(clipped, "utf8"));
    const ingest: Ingest = { id, via, chars: clipped.length, figures, ingestedAt: new Date().toISOString() };
    await store.putJSON(`${dir(id)}/ingest.json`, ingest);
    return ingest;
  });
}

// Step 2: the AI structure pass. Needs sign-in; counts toward the daily "new papers" limit only when it runs.
export async function readPaper(id: string, user: User): Promise<PaperState> {
  const state = await getState(id, user);
  if (state.structure) return state;
  const ingest = state.ingest ?? (await ingestPaper(id, user));
  const structure = await once(`structure:${id}`, async () => {
    const store = getStore();
    const done = await store.getJSON<Structure>(`${dir(id)}/structure.json`);
    if (done) return done;
    await useLimit(user.id, "paper");
    const text = (await store.getBlob(`${dir(id)}/text.txt`))?.toString("utf8") ?? "";
    const s = await structurePaper(state.meta, text, ingest.figures, ingest.via);
    await store.putJSON(`${dir(id)}/structure.json`, s);
    return s;
  });
  return { meta: state.meta, ingest, structure };
}

export async function figurePng(id: string, figId: string, user: User | null): Promise<Buffer> {
  await getMeta(id, user); // access check for uploads
  if (!/^fig\d{1,3}$/.test(figId)) throw new HttpError(404, "No such figure.");
  const png = await getStore().getBlob(`${dir(id)}/figures/${figId}.png`);
  if (!png) throw new HttpError(404, "No such figure.");
  return png;
}

export async function createUpload(user: User, data: Buffer, fileName: string): Promise<PaperMeta> {
  if (data.length > UPLOAD_MAX_BYTES) throw new HttpError(413, `PDFs can be up to ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);
  if (data.subarray(0, 5).toString() !== "%PDF-") throw new HttpError(415, "That file isn't a PDF.");
  let info: { pages: number; title: string | null };
  try {
    info = await pdfInfo(data);
  } catch {
    throw new HttpError(422, "That PDF couldn't be opened.");
  }
  if (info.pages > UPLOAD_MAX_PAGES) throw new HttpError(413, `PDFs can have up to ${UPLOAD_MAX_PAGES} pages; this one has ${info.pages}.`);
  await useLimit(user.id, "upload");

  const id = `up_${randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x")}`;
  const fromName = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  const meta: PaperMeta = {
    id,
    source: "upload",
    owner: user.id,
    title: (info.title && info.title.length > 4 ? info.title : fromName || "Untitled PDF").slice(0, 300),
    authors: [],
    abstract: "",
    pages: info.pages,
  };
  const store = getStore();
  await store.putBlob(`${dir(id)}/paper.pdf`, data);
  await store.putJSON(`${dir(id)}/meta.json`, meta);
  return meta;
}
