"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { THEMES, type PaperState, type ThemeName } from "@/lib/types";
import { overviewFor, titleCard } from "@/lib/scenes";
import { isUploadId, slugToId } from "@/lib/arxivId";
import { signInHref, useMe } from "@/lib/client/useMe";
import { Whiteboard } from "@/components/player/Whiteboard";
import { renderRich, renderTex } from "@/components/player/math";
import "./paper.css";

// The paper page: the overview player on the left, the paper's map (sections, equations, figures) on the right.
// Pages are public; reading a paper with the AI asks for sign-in.

export function PaperView({ slug }: { slug: string }) {
  const id = slugToId(slug);
  const me = useMe();
  const [state, setState] = useState<PaperState | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [theme, setTheme] = useState<ThemeName | null>(null);
  const autoRead = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/papers/${slug}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) {
      setError({ status: r.status, message: d.error ?? "This paper couldn't load." });
      return null;
    }
    setState(d);
    return d as PaperState;
  }, [slug]);

  useEffect(() => {
    void load().then(async (s) => {
      // Get the text and figures early (free, no AI), so figures show up in the player and the map.
      if (s && !s.ingest) {
        setIngesting(true);
        try {
          const r = await fetch(`/api/papers/${slug}/ingest`, { method: "POST" });
          if (r.ok) await load();
        } finally {
          setIngesting(false);
        }
      }
    });
  }, [load, slug]);

  const read = useCallback(async () => {
    setReadError(null);
    if (me === null) {
      location.assign(signInHref("read"));
      return;
    }
    setReading(true);
    try {
      const r = await fetch(`/api/papers/${slug}/read`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Reading failed.");
      setState(d);
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, [me, slug]);

  // Back from sign-in to finish the action they started.
  useEffect(() => {
    if (autoRead.current || !me || !state || state.structure) return;
    const params = new URLSearchParams(location.search);
    if (params.get("after") === "read") {
      autoRead.current = true;
      params.delete("after");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
      void read();
    }
  }, [me, state, read]);

  // Only a new paper or a new map changes what the board plays (fetching figures must not restart it).
  const hasState = Boolean(state);
  const oneLine = state?.structure?.oneLine;
  const stateRef = useRef(state);
  stateRef.current = state;
  const list = useMemo(() => {
    const s = stateRef.current;
    return s ? (overviewFor(id) ?? titleCard(s.meta, s.structure)) : null;
  }, [hasState, oneLine, id]);

  if (error) {
    return (
      <div className="wrap">
        <TopBar />
        <div className="paper-missing">
          <h1>{error.status === 404 ? "This paper isn't here." : "This paper couldn't load."}</h1>
          <p>{error.message}</p>
          <Link className="btn" href="/">
            Find another paper
          </Link>
        </div>
      </div>
    );
  }

  if (!state || !list) {
    return (
      <div className="wrap">
        <TopBar />
        <div className="paper-loading" aria-busy="true">
          <div className="ghost ghost-title" />
          <div className="ghost ghost-line" />
          <div className="paper-grid">
            <div className="ghost ghost-board" />
            <div className="ghost ghost-side" />
          </div>
        </div>
      </div>
    );
  }

  const { meta, structure, ingest } = state;
  const activeTheme = theme ?? list.theme ?? structure?.theme ?? "diagram";
  const figures = ingest?.figures ?? [];
  const figNotes = new Map(structure?.figures.map((f) => [f.id, f]) ?? []);
  const year = meta.published ? new Date(meta.published).getFullYear() : null;

  return (
    <div className="wrap">
      <TopBar />
      <header className="paper-head">
        <p className="paper-source">
          {meta.source === "arxiv" ? (
            <a href={`https://arxiv.org/abs/${meta.id}`} target="_blank" rel="noopener">
              arXiv {meta.id}
            </a>
          ) : (
            <span>Your upload, visible only to you</span>
          )}
          {year ? <span>{year}</span> : null}
          {meta.categories?.slice(0, 3).map((c) => <span key={c}>{c}</span>)}
        </p>
        <h1 className="paper-title">{meta.title}</h1>
        {meta.authors.length ? <p className="paper-authors">{meta.authors.join(", ")}</p> : null}
      </header>

      <div className="paper-grid">
        <div className="paper-main">
          <div className="style-switch" role="radiogroup" aria-label="Whiteboard style">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={activeTheme === t.id}
                className={`style-opt style-${t.id}`}
                onClick={() => setTheme(t.id)}
              >
                <span className="style-swatch" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
          <Whiteboard list={list} theme={activeTheme} paperSlug={slug} />
          {!overviewFor(id) ? (
            <p className="overview-note">
              This is the paper&apos;s title card. Full one-minute overviews, written by the tutor, are the next step of
              this build.
            </p>
          ) : null}
        </div>

        <aside className="paper-side" aria-label="Inside this paper">
          {meta.abstract ? <Abstract text={meta.abstract} /> : null}

          {!structure ? (
            <section className="read-card">
              <h2>Map this paper</h2>
              <p>
                The tutor reads the whole paper once and maps its sections, key claims, equations and figures. It takes
                about a minute.
                {isUploadId(meta.id)
                  ? " The map stays private, like your upload."
                  : " Everyone who opens this paper after you gets the map for free."}
              </p>
              <button type="button" className="btn btn-pen" onClick={() => void read()} disabled={reading}>
                {reading ? "Reading the paper…" : "Read this paper"}
              </button>
              {me === null ? <p className="read-hint">You&apos;ll be asked to sign in first.</p> : null}
              {reading ? <p className="read-hint">This usually takes 30 to 90 seconds. You can watch the board meanwhile.</p> : null}
              {readError ? <p className="error">{readError}</p> : null}
            </section>
          ) : (
            <>
              <section className="side-block">
                <h2>In one line</h2>
                <p className="one-line">{structure.oneLine}</p>
              </section>

              <section className="side-block">
                <h2>Sections</h2>
                <ol className="sections">
                  {structure.sections.map((s) => (
                    <li key={s.id} className={`section lvl-${Math.min(3, s.level)}`}>
                      <h3>{s.title}</h3>
                      <p>{s.summary}</p>
                    </li>
                  ))}
                </ol>
              </section>

              {structure.claims.length ? (
                <section className="side-block">
                  <h2>Key claims</h2>
                  <ul className="claims">
                    {structure.claims.map((c, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: renderRich(c.text) }} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {structure.equations.length ? (
                <section className="side-block">
                  <h2>Equations</h2>
                  <ul className="equations">
                    {structure.equations.map((eq) => (
                      <li key={eq.id} className="equation">
                        <div className="eq-math" dangerouslySetInnerHTML={{ __html: renderTex(eq.tex, true) }} />
                        <p dangerouslySetInnerHTML={{ __html: renderRich(eq.meaning) }} />
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
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}

          {figures.length ? (
            <section className="side-block">
              <h2>Figures</h2>
              <ul className="figures">
                {figures.map((f) => (
                  <li key={f.id}>
                    <a href={`/api/papers/${slug}/figures/${f.id}`} target="_blank" rel="noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/papers/${slug}/figures/${f.id}`} alt={f.caption} width={f.width} height={f.height} loading="lazy" />
                    </a>
                    <p>{figNotes.get(f.id)?.explanation ?? f.caption}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : ingesting ? (
            <p className="side-status">Getting the paper&apos;s figures…</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <Link href="/" className="wordmark">
        Paper Tutor
      </Link>
      <Link href="/" className="back-link">
        All papers
      </Link>
    </header>
  );
}

function Abstract({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="side-block abstract">
      <h2>Abstract</h2>
      <p className={open ? "" : "is-clamped"}>{text}</p>
      <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Show less" : "Show the whole abstract"}
      </button>
    </section>
  );
}
