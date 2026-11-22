import "server-only";
import { createCanvas, type Canvas } from "@napi-rs/canvas";

// PDF reading with pdf.js: the text, and figure crops cut from rendered page images.
// pdf.js in Node renders onto @napi-rs/canvas.

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfjsModule> | null = null;
const pdfjs = () => (pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

type TextItem = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };

async function open(data: Buffer | Uint8Array) {
  const { getDocument } = await pdfjs();
  // pdf.js takes ownership of the buffer it gets, so give it a copy.
  return getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
}

export async function pdfInfo(data: Buffer): Promise<{ pages: number; title: string | null }> {
  const doc = await open(data);
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim() || null;
    return { pages: doc.numPages, title };
  } finally {
    await doc.loadingTask.destroy();
  }
}

export type PdfFigure = { caption: string; png: Buffer; width: number; height: number };

type Line = { y: number; top: number; x0: number; x1: number; text: string; size: number };

function linesOf(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const size = Math.abs(it.transform[3]) || it.height || 10;
    const line = lines.find((l) => Math.abs(l.y - y) < size * 0.4);
    if (line) {
      line.x0 = Math.min(line.x0, x);
      line.x1 = Math.max(line.x1, x + it.width);
      line.text += (line.text.endsWith(" ") || it.str.startsWith(" ") ? "" : " ") + it.str;
      line.top = Math.max(line.top, y + size);
    } else {
      lines.push({ y, top: y + size, x0: x, x1: x + it.width, text: it.str, size });
    }
  }
  return lines.sort((a, b) => b.y - a.y); // top of the page first (PDF y grows upward)
}

const CAPTION = /^\s*(Figure|Fig\.?)\s*(\d+)\s*[:.|]/i;

// Text of every page, plus figure crops. A figure is the tallest stretch above a "Figure N:" caption that holds no
// body-text lines (body lines span most of the text column); diagram labels are short lines, so they stay inside.
export async function readPdf(
  data: Buffer,
  opts: { maxPages: number; scale?: number },
): Promise<{ pages: number; text: string; figures: PdfFigure[]; title: string | null }> {
  const doc = await open(data);
  const scale = opts.scale ?? 3;
  const pages = doc.numPages;
  const textParts: string[] = [];
  const figures: PdfFigure[] = [];
  const seen = new Set<string>();
  let title: string | null = null;
  try {
    for (let p = 1; p <= Math.min(pages, opts.maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((i) => "str" in i) as unknown as TextItem[];
      textParts.push(items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join(""));

      const lines = linesOf(items);
      if (p === 1 && lines.length) {
        // The title: the biggest type on the first page.
        const big = Math.max(...lines.map((l) => l.size));
        const t = lines.filter((l) => l.size >= big * 0.9).map((l) => l.text.trim()).join(" ").replace(/\s+/g, " ");
        if (t.length >= 8 && t.length <= 240) title = t;
      }
      const captions = lines.filter((l) => CAPTION.test(l.text));
      if (!captions.length) {
        page.cleanup();
        continue;
      }
      const colX0 = Math.min(...lines.map((l) => l.x0));
      const colX1 = Math.max(...lines.map((l) => l.x1));
      const colW = colX1 - colX0;
      const view = page.getViewport({ scale: 1 });
      const pageTop = view.height - 36;
      let rendered: Canvas | null = null;

      for (const cap of captions) {
        const num = cap.text.match(CAPTION)![2];
        if (seen.has(num)) continue;
        // Caption text: this line and the lines right under it, until a gap.
        const idx = lines.indexOf(cap);
        let caption = cap.text.trim();
        for (let k = idx + 1; k < lines.length; k++) {
          const gap = lines[k - 1].y - lines[k].y;
          if (gap > lines[k].size * 1.8 || CAPTION.test(lines[k].text)) break;
          caption += " " + lines[k].text.trim();
          if (caption.length > 700) break;
        }
        // The nearest body-text line above the caption marks where the figure starts.
        const body = lines.filter((l) => l.y > cap.top + 1 && l.x1 - l.x0 > colW * 0.6 && l.size >= cap.size * 0.85);
        const above = body.length ? Math.min(...body.map((l) => l.y)) - 3 : pageTop;
        const bottom = cap.top + 2;
        const h = above - bottom;
        if (h < 50) continue;

        if (!rendered) {
          const viewport = page.getViewport({ scale });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // pdf.js accepts the @napi-rs canvas context in Node.
          await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;
          rendered = canvas;
        }
        const sx = Math.max(0, (colX0 - 6) * scale);
        const sw = Math.min(rendered.width - sx, (colW + 12) * scale);
        const sy = Math.max(0, (view.height - above) * scale);
        const sh = Math.min(rendered.height - sy, h * scale);
        const crop = createCanvas(Math.round(sw), Math.round(sh));
        crop.getContext("2d").drawImage(rendered, sx, sy, sw, sh, 0, 0, sw, sh);
        const trimmed = trimWhite(crop);
        figures.push({ caption: caption.replace(/\s+/g, " "), png: await trimmed.encode("png"), width: trimmed.width, height: trimmed.height });
        if (figures.length >= 40) break;
        seen.add(num);
      }
      page.cleanup();
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  return { pages, text: textParts.join("\n\n"), figures, title };
}

// Render page 1 of a (figure) PDF to a PNG, trimmed to its ink.
export async function renderPdfFigure(data: Buffer, maxWidth = 1600): Promise<{ png: Buffer; width: number; height: number } | null> {
  const doc = await open(data);
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, maxWidth / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;
    const trimmed = trimWhite(canvas);
    return { png: await trimmed.encode("png"), width: trimmed.width, height: trimmed.height };
  } catch {
    return null;
  } finally {
    await doc.loadingTask.destroy();
  }
}

// Cut the white margin off an image (keeps a small border).
export function trimWhite(src: Canvas, pad = 8): Canvas {
  const ctx = src.getContext("2d");
  const { width: w, height: h } = src;
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = px[i + 3] > 20 && (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235);
      if (ink) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
  const octx = out.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
