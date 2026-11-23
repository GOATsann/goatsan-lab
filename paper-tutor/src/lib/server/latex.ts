import "server-only";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { Readable } from "node:stream";
import tar from "tar-stream";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { renderPdfFigure, trimWhite } from "./pdf";

// Reading an arXiv LaTeX source: unpack it, inline every \input, and pull out each figure (its image files and
// caption). The LaTeX itself goes to the AI: it has clean equations and the real section structure.

const MAX_FILES_BYTES = 80 * 1024 * 1024;

export async function unpackSource(data: Buffer): Promise<Map<string, Buffer> | null> {
  let raw: Buffer;
  try {
    raw = gunzipSync(data, { maxOutputLength: MAX_FILES_BYTES });
  } catch {
    raw = data; // not gzipped
  }
  if (raw.subarray(0, 5).toString() === "%PDF-") return null; // the authors uploaded only a PDF
  const isTar = raw.length > 262 && raw.subarray(257, 262).toString() === "ustar";
  if (!isTar) return new Map([["main.tex", raw]]);

  const files = new Map<string, Buffer>();
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    const extract = tar.extract();
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: unknown) => {
        if (!Buffer.isBuffer(c)) return;
        total += c.length;
        if (total <= MAX_FILES_BYTES) chunks.push(c);
      });
      stream.on("end", () => {
        if (header.type === "file") files.set(path.posix.normalize(header.name).replace(/^\.\//, ""), Buffer.concat(chunks));
        next();
      });
      stream.resume();
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    Readable.from(raw).pipe(extract);
  });
  return files;
}

const stripComments = (s: string) => s.replace(/(^|[^\\])%.*$/gm, "$1");

function findMain(files: Map<string, Buffer>): string | null {
  const candidates = [...files.keys()].filter((f) => f.endsWith(".tex") || f === "main.tex");
  const withDoc = candidates.filter((f) => /\\begin\{document\}/.test(stripComments(files.get(f)!.toString("utf8"))));
  if (!withDoc.length) return candidates[0] ?? null;
  return withDoc.sort((a, b) => files.get(b)!.length - files.get(a)!.length)[0];
}

function resolveFile(files: Map<string, Buffer>, from: string, name: string, exts: string[]): string | null {
  const base = path.posix.dirname(from);
  const tries = [name, path.posix.join(base, name)];
  for (const t of tries) {
    const n = path.posix.normalize(t);
    if (files.has(n)) return n;
    for (const e of exts) if (files.has(n + e)) return n + e;
  }
  return null;
}

// Inline \input{...} and \include{...}, recursively, comments stripped.
function flatten(files: Map<string, Buffer>, file: string, depth = 0): string {
  const src = stripComments(files.get(file)!.toString("utf8"));
  if (depth > 8) return src;
  return src.replace(/\\(?:input|include)\s*\{([^}]+)\}/g, (m, name: string) => {
    const hit = resolveFile(files, file, name.trim(), [".tex"]);
    return hit ? flatten(files, hit, depth + 1) : m;
  });
}

// The argument of a command, with nested braces: \caption{The {big} model} -> "The {big} model".
function braced(s: string, from: number): { text: string; end: number } | null {
  let i = s.indexOf("{", from);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

// Simple author macros without arguments, e.g. \newcommand{\groot}{GROOT-2} or \def\ours{GROOT}.
export function simpleMacros(preamble: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of preamble.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) out.set(m[1], m[2]);
  for (const m of preamble.matchAll(/\\def\s*\\([A-Za-z]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) out.set(m[1], m[2]);
  return out;
}

// LaTeX -> readable text for captions (math kept as $...$, author macros expanded).
export function plainCaption(s: string, macros: Map<string, string> = new Map()): string {
  let t = s;
  for (let k = 0; k < 2; k++) t = t.replace(/\\([A-Za-z]+)(\{\})?/g, (m, name: string) => (macros.has(name) ? macros.get(name)! : m));
  t = t.replace(/\\xspace\b\s*/g, " ");
  // siunitx: \SI{15}{\micro\meter} -> 15 µm, \si{\percent} -> %
  const unit = (u: string) =>
    u
      .replace(/\\micro/g, "µ").replace(/\\milli/g, "m").replace(/\\nano/g, "n").replace(/\\kilo/g, "k").replace(/\\centi/g, "c")
      .replace(/\\meter|\\metre/g, "m").replace(/\\second/g, "s").replace(/\\minute/g, "min").replace(/\\hour/g, "h")
      .replace(/\\percent/g, "%").replace(/\\gram/g, "g").replace(/\\liter|\\litre/g, "L").replace(/\\hertz/g, "Hz")
      .replace(/\\celsius|\\degreeCelsius/g, "°C").replace(/\\per\s*/g, "/").replace(/\\squared/g, "²").replace(/\\cubed/g, "³")
      .replace(/[{}\\\s]/g, "");
  t = t
    .replace(/\\SI\s*\{([^{}]*)\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_m, n: string, u: string) => `${n} ${unit(u)}`)
    .replace(/\\si\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_m, u: string) => unit(u))
    .replace(/\\num\s*\{([^{}]*)\}/g, "$1");
  const parts = t.split(/(\$[^$]*\$)/g);
  return parts
    .map((p) =>
      p.startsWith("$") && p.endsWith("$") && p.length > 1
        ? p
        : p
            .replace(/\\label\{[^}]*\}/g, "")
            .replace(/\\(?:cite|citep|citet|ref|eqref|autoref|cref|Cref)\{[^}]*\}/g, "")
            .replace(/\\(?:textbf|textit|emph|texttt|textsc|mathrm|text|textrm|underline)\{([^{}]*)\}/g, "$1")
            .replace(/~/g, " ")
            .replace(/\\\\/g, " ")
            .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?\s*/g, "")
            .replace(/[{}]/g, ""),
    )
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

export type LatexFigure = { label?: string; caption: string; png: Buffer; width: number; height: number };

async function imageToCanvas(files: Map<string, Buffer>, file: string): Promise<Canvas | null> {
  const data = files.get(file)!;
  const ext = path.posix.extname(file).toLowerCase();
  if (ext === ".pdf") {
    const r = await renderPdfFigure(data, 1400);
    if (!r) return null;
    const img = await loadImage(r.png);
    const c = createCanvas(img.width, img.height);
    c.getContext("2d").drawImage(img, 0, 0);
    return c;
  }
  if ([".png", ".jpg", ".jpeg"].includes(ext)) {
    try {
      const img = await loadImage(data);
      const c = createCanvas(img.width, img.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      return trimWhite(c);
    } catch {
      return null;
    }
  }
  return null; // .eps and friends: caption only
}

// Several images in one figure (side by side subfigures): lay them out in a row on white.
function stitch(parts: Canvas[], maxWidth = 1800): Canvas {
  if (parts.length === 1 && parts[0].width <= maxWidth) return parts[0];
  const gap = 40;
  const h = Math.max(...parts.map((p) => p.height));
  const scaled = parts.map((p) => ({ p, w: Math.round((p.width * h) / p.height) }));
  let total = scaled.reduce((a, s) => a + s.w, 0) + gap * (parts.length - 1);
  const k = Math.min(1, maxWidth / total);
  total = Math.round(total * k);
  const out = createCanvas(total, Math.round(h * k));
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  let x = 0;
  for (const s of scaled) {
    const w = s.w * k;
    ctx.drawImage(s.p, x, (out.height - s.p.height * (w / s.p.width)) / 2, w, s.p.height * (w / s.p.width));
    x += w + gap * k;
  }
  return out;
}

export async function readLatex(
  files: Map<string, Buffer>,
  opts: { figures?: boolean; onFigure?: (n: number) => void } = {},
): Promise<{ text: string; figures: LatexFigure[] } | null> {
  const main = findMain(files);
  if (!main) return null;
  const full = flatten(files, main);
  const begin = full.indexOf("\\begin{document}");
  const preamble = begin > 0 ? full.slice(0, begin) : "";
  // Keep the author's own macros: the AI needs them to read the equations.
  const macros = preamble
    .split("\n")
    .filter((l) => /\\(newcommand|renewcommand|def|DeclareMathOperator)/.test(l))
    .join("\n");
  const body = begin >= 0 ? full.slice(begin) : full;
  const defs = simpleMacros(preamble);

  const gpath = [...preamble.matchAll(/\\graphicspath\{((?:\{[^}]*\})+)\}/g)].flatMap((m) =>
    [...m[1].matchAll(/\{([^}]*)\}/g)].map((x) => x[1]),
  );
  const exts = [".pdf", ".png", ".jpg", ".jpeg", ".eps"];

  const figures: LatexFigure[] = [];
  for (const m of opts.figures === false ? [] : body.matchAll(/\\begin\{(figure\*?|wrapfigure)\}([\s\S]*?)\\end\{\1\}/g)) {
    const env = m[2];
    const capAt = env.search(/\\caption(\[[^\]]*\])?\s*\{/);
    if (capAt < 0) continue;
    const cap = braced(env, capAt + 8);
    if (!cap) continue;
    const label = env.match(/\\label\{([^}]+)\}/)?.[1];
    const parts: Canvas[] = [];
    for (const g of env.matchAll(/\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      const name = g[2].trim();
      const file =
        resolveFile(files, main, name, exts) ?? gpath.map((d) => resolveFile(files, main, d + name, exts)).find(Boolean) ?? null;
      if (!file) continue;
      const c = await imageToCanvas(files, file);
      if (c) parts.push(c);
      if (parts.length >= 6) break;
    }
    if (!parts.length) continue;
    const img = stitch(parts);
    figures.push({ label, caption: plainCaption(cap.text, defs), png: await img.encode("png"), width: img.width, height: img.height });
    opts.onFigure?.(figures.length);
    if (figures.length >= 30) break;
  }

  const text = (macros ? `% Author macros\n${macros}\n\n` : "") + body.replace(/\n{3,}/g, "\n\n");
  return { text, figures };
}
