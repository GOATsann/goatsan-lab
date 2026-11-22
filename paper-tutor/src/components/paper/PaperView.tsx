"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { THEMES, type PaperState, type ThemeName } from "@/lib/types";
import { titleCard } from "@/lib/scenes";
import type { DrawStep, Scene, SceneList } from "@/lib/scenes/types";
import { isUploadId, slugToId } from "@/lib/arxivId";
import { signInHref, useMe } from "@/lib/client/useMe";
import { readScenes, StreamError } from "@/lib/client/streams";
import { usePlayer, Whiteboard } from "@/components/player/Whiteboard";
import { renderRich, renderTex } from "@/components/player/math";
import { ChatPanel, type BoardAnswer } from "./ChatPanel";
import { Lightbox } from "./Lightbox";
import "./paper.css";

// The paper page: the whiteboard on the left (the AI overview by default, or a deep dive / explanation), the
// paper's map on the right with Deep dive and Explain this, and the chat under the board. Pages are public;
// anything that makes the AI work asks for sign-in. Everything already made is replayed free.

type Track = { kind: "overview" } | { kind: "live"; label: string };
type OverviewState = "loading" | "none" | "writing" | "ready";

const EMPTY: SceneList = { title: "", scenes: [{ say: "", draw: [] }] };
// Answers inserted into a track (and the replayed scene after them) are for that viewing only.
const transient = new WeakSet<Scene>();

declare global {
  interface Window {
    __ptTimes?: { start: number; firstScene?: number };
  }
}

export function PaperView({ slug }: { slug: string }) {
  const id = slugToId(slug);
  const me = useMe();
  const { engine, voiceOn, toggleVoice } = usePlayer(EMPTY);
  const [state, setState] = useState<PaperState | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [theme, setTheme] = useState<ThemeName | null>(null);
  const [autoTheme, setAutoTheme] = useState<ThemeName | null>(null);
  const [track, setTrack] = useState<Track>({ kind: "overview" });
  const [ov, setOv] = useState<OverviewState>("loading");
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const overviewList = useRef<SceneList | null>(null);
  const liveAbort = useRef<AbortController | null>(null);
  const started = useRef(false);
  const player = useRef<HTMLDivElement>(null);

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

  // The overview: replay the saved one, or show the title card until someone presses play.
  useEffect(() => {
    if (!engine || !state || started.current) return;
    started.current = true;
    void (async () => {
      const r = await fetch(`/api/papers/${slug}/overview`, { cache: "no-store" });
      const d = r.ok ? await r.json() : null;
      if (d?.overview?.scenes?.length) {
        const list: SceneList = { title: state.meta.title, paper: state.meta.source === "arxiv" ? state.meta.id : undefined, scenes: d.overview.scenes };
        overviewList.current = list;
        if (d.overview.theme) setAutoTheme(d.overview.theme);
        engine.load(list);
        setOv("ready");
      } else {
        engine.load(titleCard(state.meta, state.structure));
        setOv("none");
        if (new URLSearchParams(location.search).get("after") === "overview") clearAfter();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, state]);

  const startOverview = useCallback(
    (play: boolean) => {
      if (!engine || !state) return;
      setTutorError(null);
      if (me === null) {
        location.assign(signInHref("overview"));
        return;
      }
      liveAbort.current?.abort();
      const list: SceneList = { title: state.meta.title, paper: state.meta.source === "arxiv" ? state.meta.id : undefined, scenes: [] };
      overviewList.current = list;
      engine.load(list);
      const block = engine.openBlock(0, list);
      if (play) engine.play();
      setTrack({ kind: "overview" });
      setOv("writing");
      window.__ptTimes = { start: performance.now() };
      let got = 0;
      readScenes(`/api/papers/${slug}/overview`, { voice: engine.voice }, {
        meta: (m) => m.theme && setAutoTheme(m.theme),
        scene: (s) => {
          if (!got++ && window.__ptTimes) window.__ptTimes.firstScene = performance.now() - window.__ptTimes.start;
          block.push(s);
        },
      })
        .then(() => {
          block.close();
          setOv("ready");
        })
        .catch((e: StreamError) => {
          block.close();
          setTutorError(e.message);
          if (!got) {
            overviewList.current = null;
            engine.load(titleCard(state.meta, state.structure));
            setOv("none");
          } else setOv("ready");
        });
    },
    [engine, state, me, slug],
  );

  // Nobody has watched this paper yet and someone signed in is here: start writing the overview now, quietly,
  // so pressing play joins a stream that is already under way. (Signed-out visitors don't start it.)
  const preloaded = useRef(false);
  useEffect(() => {
    if (ov !== "none" || !me || preloaded.current) return;
    preloaded.current = true;
    startOverview(false);
  }, [ov, me, startOverview]);

  // While the paper is being mapped (it starts with the first overview), check back for the map.
  useEffect(() => {
    if (!state || state.structure || (ov !== "writing" && ov !== "ready" && !reading)) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [state, ov, reading, load]);

  const scrollToPlayer = () => {
    const el = player.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // A deep dive or an explanation: its own track on the same player, written live (or replayed if saved).
  const startLive = useCallback(
    (req: Record<string, string>, label: string) => {
      if (!engine || !state) return;
      setTutorError(null);
      if (me === null) {
        location.assign(signInHref());
        return;
      }
      liveAbort.current?.abort();
      const ctrl = new AbortController();
      liveAbort.current = ctrl;
      const list: SceneList = { title: label, paper: state.meta.source === "arxiv" ? state.meta.id : undefined, scenes: [] };
      engine.load(list);
      const block = engine.openBlock(0, list);
      engine.play();
      setTrack({ kind: "live", label });
      scrollToPlayer();
      let got = 0;
      readScenes(`/api/papers/${slug}/tutor`, req, { scene: (s) => (got++, block.push(s)) }, ctrl.signal)
        .then(() => block.close())
        .catch((e: Error) => {
          block.close();
          if (e.name === "AbortError") return;
          setTutorError(e.message);
          if (!got) backToOverview();
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, state, me, slug],
  );

  const backToOverview = useCallback(() => {
    if (!engine || !state) return;
    liveAbort.current?.abort();
    setTrack({ kind: "overview" });
    const saved = overviewList.current;
    if (saved) {
      // Drop answers inserted during an earlier viewing; keep any scenes still being written.
      saved.scenes = saved.scenes.filter((s) => !transient.has(s));
      engine.load(saved);
    } else engine.load(titleCard(state.meta, state.structure));
  }, [engine, state]);

  // A question answered on the board: pause, answer on the same board, then replay the interrupted scene and
  // carry on.
  const askOnBoard = useCallback(
    async (question: string, history: { role: "user" | "assistant"; text: string }[], onScene: (s: Scene) => void): Promise<BoardAnswer> => {
      if (!engine) throw new Error("The player isn't ready.");
      const e = engine;
      const list = e.list;
      let i = e.sceneIndex;
      while (i > 0 && list.scenes[i]?.pending) i--;
      const cur = list.scenes[i] ?? { say: "", draw: [] };
      const base: DrawStep[] = [];
      for (let k = i; k > 0 && list.scenes[k]?.keep; k--) base.unshift(...list.scenes[k - 1].draw);
      const wasEnded = e.ended || (i === list.scenes.length - 1 && e.time > 0 && !e.playing);
      e.pause();
      const at = i + 1;
      const block = e.openBlock(at);
      if (!wasEnded && cur.say) {
        // After the answer, the interrupted scene plays again from its start.
        const replay: Scene = { ...cur, keep: false, draw: [...base.filter((s) => s.t !== "camera"), ...cur.draw] };
        transient.add(replay);
        e.insertScenes(at + 1, [replay]);
      }
      e.goto(at);
      e.play();
      scrollToPlayer();
      const says: string[] = [];
      const cites = new Set<string>();
      try {
        await readScenes(
          `/api/papers/${slug}/tutor`,
          { mode: "ask", question, history, board: { say: cur.say, draw: [...base, ...cur.draw] } },
          {
            scene: (s) => {
              says.push(s.say);
              s.cite?.forEach((c) => cites.add(c));
              onScene(s);
              transient.add(s);
              block.push(s);
            },
          },
        );
      } finally {
        block.close();
      }
      return { says, cites: [...cites] };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, slug],
  );

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
  const autoRead = useRef(false);
  useEffect(() => {
    if (autoRead.current || !me || !state || state.structure) return;
    if (new URLSearchParams(location.search).get("after") === "read") {
      autoRead.current = true;
      clearAfter();
      void read();
    }
  }, [me, state, read]);

  const sectionTitle = useCallback((sid: string) => state?.structure?.sections.find((s) => s.id === sid)?.title, [state]);
  const goToSection = useCallback((sid: string) => {
    const el = document.getElementById(`sec-${sid}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("is-flashed");
    void el.offsetWidth;
    el.classList.add("is-flashed");
  }, []);

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

  if (!state) {
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
  const activeTheme = theme ?? autoTheme ?? structure?.theme ?? "diagram";
  const figures = ingest?.figures ?? [];
  const figNotes = new Map(structure?.figures.map((f) => [f.id, f]) ?? []);
  const year = meta.published ? new Date(meta.published).getFullYear() : null;
  const mapping = !structure && (ov === "writing" || ov === "ready" || reading);

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
        <div className="paper-main" ref={player}>
          <div className="player-bar">
            {track.kind === "live" ? (
              <div className="track">
                <button type="button" className="link-btn" onClick={backToOverview}>
                  Back to the overview
                </button>
                <span className="track-label">{track.label}</span>
              </div>
            ) : (
              <div className="track">
                <span className="track-label">{ov === "writing" ? "Overview (writing it now)" : "One-minute overview"}</span>
              </div>
            )}
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
          </div>
          <Whiteboard
            engine={engine}
            voiceOn={voiceOn}
            toggleVoice={toggleVoice}
            theme={activeTheme}
            paperSlug={slug}
            onStart={ov === "loading" ? () => {} : track.kind === "overview" && ov === "none" ? () => startOverview(true) : undefined}
            startLabel="Play the overview"
            sectionTitle={sectionTitle}
            onCite={goToSection}
            onFigure={(fig) => {
              engine?.pause();
              const f = state.ingest?.figures.find((x) => x.id === fig);
              setLightbox({ src: `/api/papers/${slug}/figures/${fig}`, caption: f?.caption ?? "" });
            }}
          />
          {tutorError ? <p className="error tutor-error">{tutorError}</p> : null}
          {track.kind === "overview" && ov === "none" && me === null ? (
            <p className="overview-note">Nobody has watched this paper yet. Sign in to play it first; after that it plays for everyone.</p>
          ) : null}

          <ChatPanel slug={slug} signedIn={Boolean(me)} sectionTitle={sectionTitle} onCite={goToSection} askOnBoard={askOnBoard} pausePlayer={() => engine?.pause()} />
        </div>

        <aside className="paper-side" aria-label="Inside this paper">
          {meta.abstract ? <Abstract text={meta.abstract} /> : null}

          {!structure ? (
            mapping ? (
              <section className="read-card">
                <h2>Mapping the paper</h2>
                <p>The tutor is reading the whole paper to map its sections, equations and figures for deep dives. This takes about a minute.</p>
              </section>
            ) : (
              <section className="read-card">
                <h2>Map this paper</h2>
                <p>
                  The tutor reads the whole paper once and maps its sections, key claims, equations and figures, so you
                  can deep dive into any part. It takes about a minute.
                  {isUploadId(meta.id) ? " The map stays private, like your upload." : " Everyone who opens this paper after you gets the map for free."}
                </p>
                <button type="button" className="btn btn-pen" onClick={() => void read()} disabled={reading}>
                  {reading ? "Mapping the paper…" : "Map the paper"}
                </button>
                {me === null ? <p className="read-hint">You&apos;ll be asked to sign in first.</p> : null}
                {readError ? <p className="error">{readError}</p> : null}
              </section>
            )
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
                    <li key={s.id} id={`sec-${s.id}`} className={`section lvl-${Math.min(3, s.level)}`}>
                      <div className="section-head">
                        <h3>{s.title}</h3>
                        <button type="button" className="mini-btn" onClick={() => startLive({ mode: "deepdive", section: s.id }, `Deep dive: ${s.title}`)}>
                          Deep dive
                        </button>
                      </div>
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
                        <div className="eq-actions">
                          <button type="button" className="mini-btn" onClick={() => startLive({ mode: "explain", eq: eq.id }, "Explaining an equation")}>
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
                    <button
                      type="button"
                      className="figure-open"
                      onClick={() => setLightbox({ src: `/api/papers/${slug}/figures/${f.id}`, caption: f.caption })}
                      aria-label={`Open figure ${f.id.replace("fig", "")} large`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/papers/${slug}/figures/${f.id}`} alt={f.caption} width={f.width} height={f.height} loading="lazy" />
                    </button>
                    <p dangerouslySetInnerHTML={{ __html: renderRich(figNotes.get(f.id)?.explanation ?? f.caption) }} />
                    {structure ? (
                      <button type="button" className="mini-btn" onClick={() => startLive({ mode: "explain", fig: f.id }, `Explaining figure ${f.id.replace("fig", "")}`)}>
                        Explain this
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : ingesting ? (
            <p className="side-status">Getting the paper&apos;s figures…</p>
          ) : null}
        </aside>
      </div>
      {lightbox ? <Lightbox src={lightbox.src} caption={lightbox.caption} onClose={closeLightbox} /> : null}
    </div>
  );
}

function clearAfter() {
  const params = new URLSearchParams(location.search);
  params.delete("after");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
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
