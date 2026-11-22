import Link from "next/link";
import type { PaperCard } from "@/lib/types";
import { idToSlug } from "@/lib/arxivId";

// One paper in a list: like an index card in a library drawer. Papers that aren't on arXiv open from their PDF
// link (or, without a free PDF, link out to where they are listed).
export function PaperRow({ paper, onOpenPdf }: { paper: PaperCard; onOpenPdf?: (url: string) => void }) {
  const authors = paper.authors.length > 4 ? `${paper.authors.slice(0, 4).join(", ")} and ${paper.authors.length - 4} more` : paper.authors.join(", ");
  const date = paper.published ? new Date(paper.published).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const body = (
    <>
      <h3 className="row-title">
        <span className="marked">{paper.title}</span>
      </h3>
      <p className="row-meta">
        {authors}
        {date ? <span className="row-date">{date}</span> : null}
      </p>
      {paper.abstract ? <p className="row-abstract">{paper.abstract}</p> : null}
    </>
  );
  const external = paper.id.startsWith("s2_");
  return (
    <li className="row">
      {!external ? (
        <Link className="row-link" href={`/paper/${idToSlug(paper.id)}`}>
          {body}
        </Link>
      ) : paper.pdfUrl ? (
        <button type="button" className="row-link row-button" onClick={() => onOpenPdf?.(paper.pdfUrl!)}>
          {body}
          <span className="row-note">Not on arXiv. Opens from its free PDF.</span>
        </button>
      ) : (
        <a className="row-link" href={paper.link} target="_blank" rel="noopener">
          {body}
          <span className="row-note">Not on arXiv, and no free PDF. Opens on Semantic Scholar.</span>
        </a>
      )}
      {typeof paper.upvotes === "number" ? (
        <span className="row-votes" title="Upvotes on Hugging Face Daily Papers">
          <svg viewBox="0 0 12 12" aria-hidden>
            <path d="M6 2l4.5 6h-9z" />
          </svg>
          {paper.upvotes}
          <span className="visually-hidden"> upvotes</span>
        </span>
      ) : null}
    </li>
  );
}
