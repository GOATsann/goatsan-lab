import katex from "katex";

// KaTeX with highlightable terms: \term{name}{...} becomes \htmlClass{term term-name}{...}.
const TERM = /\\term\{([A-Za-z0-9_-]+)\}/g;

const cache = new Map<string, string>();

export function renderTex(tex: string, display: boolean): string {
  const key = `${display ? "D" : "i"}${tex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const html = katex.renderToString(tex.replace(TERM, "\\htmlClass{term term-$1}"), {
    displayMode: display,
    throwOnError: false,
    strict: "ignore",
    output: "html",
    trust: (ctx) => ctx.command === "\\htmlClass",
  });
  cache.set(key, html);
  return html;
}

// Text with inline $...$ math, as HTML. Everything outside math is escaped.
export function renderRich(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return text
    .split(/(\$[^$]+\$)/g)
    .map((part) => (part.length > 2 && part.startsWith("$") && part.endsWith("$") ? renderTex(part.slice(1, -1), false) : esc(part)))
    .join("");
}
