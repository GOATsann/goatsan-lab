import Link from "next/link";
import type { PaperCard } from "@/lib/types";
import { idToSlug } from "@/lib/arxivId";

// One paper in a list: like an index card in a library drawer.
export function PaperRow({ paper }: { paper: PaperCard }) {
  const authors = paper.authors.length > 4 ? `${paper.authors.slice(0, 4).join(", ")} and ${paper.authors.length - 4} more` : paper.authors.join(", ");
  const date = paper.published ? new Date(paper.published).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  return (
    <li className="row">
      <Link className="row-link" href={`/paper/${idToSlug(paper.id)}`}>
        <h3 className="row-title">
          <span className="marked">{paper.title}</span>
        </h3>
        <p className="row-meta">
          {authors}
          {date ? <span className="row-date">{date}</span> : null}
        </p>
        <p className="row-abstract">{paper.abstract}</p>
      </Link>
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
