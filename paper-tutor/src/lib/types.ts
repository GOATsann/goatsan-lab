// Shapes shared by the server and the browser.

export type ThemeName = "chalkboard" | "diagram" | "illustrated";
export const THEMES: { id: ThemeName; label: string }[] = [
  { id: "chalkboard", label: "Chalkboard" },
  { id: "diagram", label: "Diagram" },
  { id: "illustrated", label: "Illustrated" },
];

// A paper in a list (trending, search, browse).
export type PaperCard = {
  id: string; // arXiv id ("1706.03762") or an upload id ("up_...")
  title: string;
  authors: string[];
  abstract: string;
  published?: string; // ISO date
  categories?: string[];
  upvotes?: number; // Hugging Face Daily Papers
  thumbnail?: string;
  pdfUrl?: string; // not on arXiv, but there is a free PDF (opened through a link import)
  link?: string; // not on arXiv: where to read about it
};

export type PaperMeta = PaperCard & {
  source: "arxiv" | "upload";
  owner?: string; // uploads only: the WorkOS user id that may see it
  sourceUrl?: string; // a PDF fetched from a link
  pages?: number;
};

export type Figure = {
  id: string; // "fig1", "fig2"...
  label?: string; // the LaTeX \label, if any
  caption: string;
  width: number;
  height: number;
};

// What reading the paper produced before the AI pass: the text and the figure crops.
export type Ingest = {
  id: string;
  via: "latex" | "pdf";
  chars: number;
  figures: Figure[];
  ingestedAt: string;
};

export type Symbol = { tex: string; meaning: string };
export type Equation = { id: string; tex: string; meaning: string; section: string; symbols: Symbol[] };
export type Section = { id: string; title: string; level: number; summary: string };
export type Claim = { text: string; section: string };
export type FigureNote = { id: string; caption: string; explanation: string; section: string };

export type PaperType = "math" | "ai-systems" | "bio-medicine" | "physics" | "other";

// The one AI structure pass, saved as JSON per paper.
export type Pronunciation = { written: string; spoken: string };

export type Structure = {
  paperType: PaperType;
  theme: ThemeName;
  oneLine: string;
  sections: Section[];
  claims: Claim[];
  equations: Equation[];
  figures: FigureNote[];
  pronunciations?: Pronunciation[]; // how to say tricky names out loud
  model: string;
  createdAt: string;
};

export type PaperState = {
  meta: PaperMeta;
  ingest: Ingest | null;
  structure: Structure | null;
};

export function themeFor(type: PaperType): ThemeName {
  if (type === "math" || type === "physics") return "chalkboard";
  if (type === "bio-medicine") return "illustrated";
  return "diagram";
}
