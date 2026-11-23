"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { Figure, Structure } from "@/lib/types";
import { renderRich, renderTex } from "@/components/player/math";

// The paper as an outline: every section collapsed to its title and one line, a filter at the top, and an
// index of jump links that stays in view. Opening a section shows Deep dive, then its equations and figures.

type Props = {
  slug: string;
  structure: Structure;
  figures: Figure[];
  abstract: string;
  onDeepDive: (section: string, title: string) => void;
  onExplainEq: (eq: string, label: string) => void;
  onExplainFig: (fig: string) => void;
  onOpenFigure: (src: string, caption: string) => void;
  open: Set<string>;
  setOpen: (next: Set<string>) => void;
};

const firstSentence = (s: string) => {
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : s;
};
const plain = (s: string) => s.replace(/\$[^$]*\$/g, " ").toLowerCase();

export const shortLabel = (s: string) => {
  const p = s.replace(/\$[^$]*\$/g, "").replace(/\s+/g, " ").trim();
  const words = p.split(" ");
  return words.length > 7 ? `${words.slice(0, 7).join(" ")}…` : p;
};

export function SectionsPanel({ slug, structure, figures, abstract, onDeepDive, onExplainEq, onExplainFig, onOpenFigure, open, setOpen }: Props) {
  const [q, setQ] = useState("");
  const figById = useMemo(() => new Map(figures.map((f) => [f.id, f])), [figures]);
  const sectionIds = useMemo(() => new Set(structure.sections.map((s) => s.id)), [structure]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return structure.sections.map((s) => {
      const eqs = structure.equations.filter((e) => e.section === s.id);
      const figs = structure.figures.filter((f) => f.section === s.id && figById.has(f.id));
      const hay = [s.title, s.summary, ...eqs.map((e) => e.meaning), ...figs.map((f) => `${f.caption} ${f.explanation}`)].map(plain).join(" ");
      return { s, eqs, figs, match: !needle || hay.includes(needle) };
    });
  }, [q, structure, figById]);
  const otherEqs = structure.equations.filter((e) => !sectionIds.has(e.section));
  const usedFigs = new Set(structure.figures.filter((f) => sectionIds.has(f.section)).map((f) => f.id));
  const otherFigs = figures.filter((f) => !usedFigs.has(f.id));
  const filtering = q.trim().length > 0;
  const shown = rows.filter((r) => r.match);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const jump = (id: string) => {
    const next = new Set(open);
    next.add(id);
    setOpen(next);
    requestAnimationFrame(() => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="outline">
      <div className="outline-tools">
        <label className="outline-search">
          <Search size={16} strokeWidth={2} aria-hidden />
          <span className="visually-hidden">Find in this paper</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a section, equation or figure" />
        </label>
        <nav className="outline-index" aria-label="On this page">
          {structure.sections
            .filter((s) => s.level <= 1)
            .map((s) => (
              <button key={s.id} type="button" onClick={() => jump(s.id)}>
                {s.title}
              </button>
            ))}
          {otherFigs.length ? (
            <button type="button" onClick={() => document.getElementById("outline-figures")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              All figures
            </button>
          ) : null}
        </nav>
      </div>

      {!filtering ? (
        <details className="outline-about">
          <summary>About this paper</summary>
          <p className="one-line">{structure.oneLine}</p>
          {structure.claims.length ? (
            <ul className="claims">
              {structure.claims.map((c, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: renderRich(c.text) }} />
              ))}
            </ul>
          ) : null}
          {abstract ? <p className="outline-abstract">{abstract}</p> : null}
        </details>
      ) : null}

      {shown.length === 0 ? <p className="outline-empty">Nothing in this paper matches “{q}”.</p> : null}
      <ol className="outline-list">
        {shown.map(({ s, eqs, figs }) => {
          const isOpen = filtering || open.has(s.id);
          return (
            <li key={s.id} id={`sec-${s.id}`} className={`outline-item lvl-${Math.min(3, s.level)} ${isOpen ? "is-open" : ""}`}>
              <button type="button" className="outline-head" onClick={() => toggle(s.id)} aria-expanded={isOpen}>
                <ChevronRight size={16} strokeWidth={2.2} aria-hidden className="outline-chevron" />
                <span className="outline-title">{s.title}</span>
                {!isOpen ? <span className="outline-line">{firstSentence(s.summary)}</span> : null}
                {eqs.length || figs.length ? (
                  <span className="outline-meta">
                    {eqs.length ? `${eqs.length} equation${eqs.length > 1 ? "s" : ""}` : ""}
                    {eqs.length && figs.length ? ", " : ""}
                    {figs.length ? `${figs.length} figure${figs.length > 1 ? "s" : ""}` : ""}
                  </span>
                ) : null}
              </button>
              {isOpen ? (
                <div className="outline-body">
                  <p>{s.summary}</p>
                  <button type="button" className="mini-btn" onClick={() => onDeepDive(s.id, s.title)}>
                    Deep dive
                  </button>
                  {eqs.map((eq) => (
                    <Eq key={eq.id} eq={eq} onExplain={() => onExplainEq(eq.id, shortLabel(eq.meaning))} />
                  ))}
                  {figs.map((f) => {
                    const fig = figById.get(f.id)!;
                    return <Fig key={f.id} slug={slug} fig={fig} text={f.explanation || fig.caption} onOpen={onOpenFigure} onExplain={() => onExplainFig(f.id)} />;
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {!filtering && otherEqs.length ? (
        <section className="outline-extra">
          <h3>Other equations</h3>
          {otherEqs.map((eq) => (
            <Eq key={eq.id} eq={eq} onExplain={() => onExplainEq(eq.id, shortLabel(eq.meaning))} />
          ))}
        </section>
      ) : null}
      {!filtering && otherFigs.length ? (
        <section className="outline-extra" id="outline-figures">
          <h3>All figures</h3>
          {otherFigs.map((f) => (
            <Fig key={f.id} slug={slug} fig={f} text={f.caption} onOpen={onOpenFigure} onExplain={() => onExplainFig(f.id)} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Eq({ eq, onExplain }: { eq: Structure["equations"][number]; onExplain: () => void }) {
  return (
    <div className="equation">
      <div className="eq-math" dangerouslySetInnerHTML={{ __html: renderTex(eq.tex, true) }} />
      <p dangerouslySetInnerHTML={{ __html: renderRich(eq.meaning) }} />
      <div className="eq-actions">
        <button type="button" className="mini-btn" onClick={onExplain}>
          Explain this
        </button>
        {eq.symbols.length ? (
          <details>
            <summary>What the symbols mean</summary>
            <dl>
              {eq.symbols.map((s, k) => (
                <div key={k}>
                  <dt dangerouslySetInnerHTML={{ __html: renderTex(s.tex, false) }} />
                  <dd>{s.meaning}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function Fig({ slug, fig, text, onOpen, onExplain }: { slug: string; fig: Figure; text: string; onOpen: (src: string, caption: string) => void; onExplain: () => void }) {
  const src = `/api/papers/${slug}/figures/${fig.id}`;
  return (
    <div className="outline-fig">
      <button type="button" className="figure-open" onClick={() => onOpen(src, fig.caption)} aria-label={`Open figure ${fig.id.replace("fig", "")} large`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={fig.caption} width={fig.width} height={fig.height} loading="lazy" />
      </button>
      <p dangerouslySetInnerHTML={{ __html: renderRich(text) }} />
      <button type="button" className="mini-btn" onClick={onExplain}>
        Explain this
      </button>
    </div>
  );
}
