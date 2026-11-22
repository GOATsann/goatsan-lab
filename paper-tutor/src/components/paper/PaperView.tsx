"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { THEMES, type PaperState, type ThemeName } from "@/lib/types";
import { titleCard } from "@/lib/scenes";
import type { DrawStep, Scene, SceneList } from "@/lib/scenes/types";
import { isUploadId, slugToId } from "@/lib/arxivId";
import { signInHref, useMe } from "@/lib/client/useMe";
import { readScenes, readText, StreamError } from "@/lib/client/streams";
import { usePlayer, Whiteboard } from "@/components/player/Whiteboard";
import { renderRich, renderTex } from "@/components/player/math";
import { AskBox, SessionHistory, type AskMode, type HistoryItem } from "./SessionPanel";
import { Lightbox } from "./Lightbox";
import "./paper.css";

// The paper page is one stage and one history. The board plays everything (the overview, deep dives,
// explanations, answers to questions); the history lists everything that played or was asked, in order, and
// replays any of it. The question box is always there. Pages are public; making the AI work asks for sign-in.

type Track = { kind: "overview" } | { kind: "live"; label: string };
type OverviewState = "loading" | "none" | "writing" | "ready";
type Tab = "session" | "paper";

const EMPTY: SceneList = { title: "", scenes: [{ say: "", draw: [] }] };
// Answers inserted into a track, and the replayed scene after them, belong to that viewing only.
const transient = new WeakSet<Scene>();
const answers = new WeakSet<Scene>();
const MAX_HISTORY = 60;
const newId = () => Math.random().toString(36).slice(2, 10);

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
  const trackRef = useRef<Track>(track);
  trackRef.current = track;
  const [ov, setOv] = useState<OverviewState>("loading");
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const [tab, setTab] = useState<Tab>("session");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [mini, setMini] = useState(false);
  const overviewList = useRef<SceneList | null>(null);
  const liveAbort = useRef<AbortController | null>(null);
  const started = useRef(false);
  const stageSlot = useRef<HTMLDivElement>(null);

  // ---- the paper ----
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

  // ---- the session history, kept per person and paper in this browser ----
  const storeKey = me === undefined ? null : `pt-history:${me?.id ?? "anon"}:${id}`;
  const historyLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!storeKey || historyLoaded.current === storeKey) return;
    historyLoaded.current = storeKey;
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? "[]") as HistoryItem[];
      if (Array.isArray(saved)) setHistory(saved);
    } catch {}
  }, [storeKey]);
  useEffect(() => {
    if (!storeKey || historyLoaded.current !== storeKey) return;
    try {
      const keep = history.filter((h) => !(h.kind === "ask" && h.pending)).slice(-MAX_HISTORY);
      localStorage.setItem(storeKey, JSON.stringify(keep));
    } catch {}
  }, [history, storeKey]);
  const addCard = useCallback((item: HistoryItem) => {
    setHistory((h) => [...h, item].slice(-MAX_HISTORY));
    setCurrentId(item.kind === "ask" && item.mode === "text" ? null : item.id);
  }, []);
  const patchCard = useCallback((cardId: string, patch: Partial<HistoryItem>) => {
    setHistory((h) => h.map((it) => (it.id === cardId ? ({ ...it, ...patch } as HistoryItem) : it)));
  }, []);

  // ---- the overview ----
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
      const list: SceneList = { title: state.meta.title, paper: state.meta.source === "arxiv" ? state.meta.id : undefined, scenes: [] };
      overviewList.current = list;
      // A background start doesn't take the board away from something else that is playing.
      const show = play || trackRef.current.kind === "overview";
      if (show) {
        liveAbort.current?.abort();
        engine.load(list);
        setTrack({ kind: "overview" });
      }
      const block = engine.openBlock(0, list);
      if (play) engine.play();
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
            if (engine.list === list) engine.load(titleCard(state.meta, state.structure));
            setOv("none");
          } else setOv("ready");
        });
    },
    [engine, state, me, slug],
  );

  // Someone signed in opened a paper nobody has watched: start writing its overview now, quietly, so play joins
  // a stream already under way. Signed-out visitors don't start it.
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

  const showStage = () => {
    const el = stageSlot.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const playOverview = useCallback(
    (fromCard: boolean) => {
      if (!engine || !state) return;
      liveAbort.current?.abort();
      setTrack({ kind: "overview" });
      const saved = overviewList.current;
      if (saved) {
        saved.scenes = saved.scenes.filter((s) => !transient.has(s));
        engine.load(saved);
        if (fromCard) engine.play();
      } else {
        engine.load(titleCard(state.meta, state.structure));
        if (fromCard) startOverview(true);
      }
    },
    [engine, state, startOverview],
  );

  // A deep dive or an explanation: its own track on the board, written live (or replayed if saved).
  const startLive = useCallback(
    (req: Record<string, string>, label: string, card: HistoryItem | null, replayId?: string) => {
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
      if (card) addCard(card);
      else if (replayId) setCurrentId(replayId);
      showStage();
      let got = 0;
      readScenes(`/api/papers/${slug}/tutor`, req, { scene: (s) => (got++, block.push(s)) }, ctrl.signal)
        .then(() => block.close())
        .catch((e: Error) => {
          block.close();
          if (e.name === "AbortError") return;
          setTutorError(e.message);
          if (!got) playOverview(false);
        });
    },
    [engine, state, me, slug, addCard, playOverview],
  );

  const deepDive = (section: string, title: string) =>
    startLive({ mode: "deepdive", section }, `Deep dive: ${title}`, { id: newId(), kind: "deepdive", section, label: `Deep dive: ${title}` });
  const explainEq = (eq: string, label: string) =>
    startLive({ mode: "explain", eq }, `Explain: ${label}`, { id: newId(), kind: "explain", eq, label: `Explain: ${label}` });
  const explainFig = (fig: string) => {
    const label = `Explain: Figure ${fig.replace("fig", "")}`;
    startLive({ mode: "explain", fig }, label, { id: newId(), kind: "explain", fig, label });
  };

  // ---- asking ----
  // On the board: pause, answer on the same board, then replay the interrupted scene and carry on.
  const askOnBoard = useCallback(
    async (question: string, hist: { role: "user" | "assistant"; text: string }[], card: string) => {
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
        const replay: Scene = { ...cur, keep: false, draw: [...base.filter((s) => s.t !== "camera"), ...cur.draw] };
        transient.add(replay);
        e.insertScenes(at + 1, [replay]);
      }
      e.goto(at);
      e.play();
      showStage();
      const scenes: Scene[] = [];
      const cites = new Set<string>();
      try {
        await readScenes(
          `/api/papers/${slug}/tutor`,
          { mode: "ask", question, history: hist, board: { say: cur.say, draw: [...base, ...cur.draw] } },
          {
            scene: (s) => {
              scenes.push(s);
              s.cite?.forEach((c) => cites.add(c));
              transient.add(s);
              answers.add(s);
              block.push(s);
              patchCard(card, { answer: scenes.map((x) => x.say).join(" "), cites: [...cites] });
            },
          },
        );
      } finally {
        block.close();
      }
      return { scenes, cites: [...cites] };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, slug, patchCard],
  );

  const ask = useCallback(
    async (question: string, mode: AskMode) => {
      if (me === null) {
        location.assign(signInHref());
        return;
      }
      const hist = history
        .filter((h): h is Extract<HistoryItem, { kind: "ask" }> => h.kind === "ask" && !h.pending && !h.error)
        .slice(-4)
        .flatMap((h) => [
          { role: "user" as const, text: h.question },
          { role: "assistant" as const, text: h.answer },
        ]);
      const card = newId();
      addCard({ id: card, kind: "ask", question, mode, answer: "", cites: [], pending: true });
      setTab("session");
      setAsking(true);
      try {
        if (mode === "board") {
          const out = await askOnBoard(question, hist, card);
          patchCard(card, { pending: false, scenes: out.scenes, cites: out.cites, answer: out.scenes.map((s) => s.say).join(" ") || "(no answer)" });
        } else {
          engine?.pause();
          const text = await readText(`/api/papers/${slug}/chat`, { question, history: hist }, (all) => patchCard(card, { answer: all }));
          patchCard(card, { pending: false, answer: text });
        }
      } catch (err) {
        patchCard(card, { pending: false, error: (err as Error).message });
      } finally {
        setAsking(false);
      }
    },
    [me, history, addCard, patchCard, askOnBoard, engine, slug],
  );

  // ---- replaying a card ----
  const replay = useCallback(
    (it: HistoryItem) => {
      if (!engine) return;
      setTutorError(null);
      if (it.kind === "overview") {
        playOverview(true);
        setCurrentId(it.id);
        showStage();
      } else if (it.kind === "deepdive") startLive({ mode: "deepdive", section: it.section }, it.label, null, it.id);
      else if (it.kind === "explain") startLive({ mode: "explain", ...(it.eq ? { eq: it.eq } : { fig: it.fig ?? "" }) }, it.label, null, it.id);
      else if (it.kind === "ask" && it.scenes?.length && state) {
        liveAbort.current?.abort();
        const scenes = it.scenes.map((s) => ({ ...s, keep: false }));
        scenes.forEach((s) => answers.add(s));
        engine.load({ title: "Answering your question", paper: state.meta.source === "arxiv" ? state.meta.id : undefined, scenes });
        engine.play();
        setTrack({ kind: "live", label: "Answering your question" });
        setCurrentId(it.id);
        showStage();
      }
    },
    [engine, state, playOverview, startLive],
  );

  // ---- the map ----
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
      if (!r.ok) throw new Error(d.error ?? "Mapping failed.");
      setState(d);
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, [me, slug]);

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
    setTab("paper");
    requestAnimationFrame(() => {
      const el = document.getElementById(`sec-${sid}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("is-flashed");
      void el.offsetWidth;
      el.classList.add("is-flashed");
    });
  }, []);

  // ---- phones: the board shrinks into a mini player pinned to the top while the history scrolls ----
  useEffect(() => {
    const slot = stageSlot.current;
    if (!slot) return;
    const phone = window.matchMedia("(max-width: 960px)");
    const io = new IntersectionObserver(
      ([e]) => setMini(phone.matches && !e.isIntersecting && e.boundingClientRect.top < 0),
      { threshold: 0, rootMargin: "-56px 0px 0px 0px" },
    );
    io.observe(slot);
    const onChange = () => !phone.matches && setMini(false);
    phone.addEventListener("change", onChange);
    return () => {
      io.disconnect();
      phone.removeEventListener("change", onChange);
    };
  }, [state]);
  // Keep the slot's height while the board is pinned, so the page doesn't jump.
  const [slotHeight, setSlotHeight] = useState<number | null>(null);
  useEffect(() => {
    const slot = stageSlot.current;
    if (!slot || mini) return;
    const ro = new ResizeObserver(() => setSlotHeight(slot.offsetHeight));
    ro.observe(slot);
    return () => ro.disconnect();
  }, [mini, state]);

  // Phones: keep the question box above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${covered}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
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
  const answering = engine ? answers.has(engine.scene) || (engine.scene.pending && asking && track.kind === "overview") : false;
  const boardLabel = answering ? "Answering your question" : track.kind === "overview" ? (ov === "writing" ? "Overview (writing it now)" : "Overview") : track.label;

  return (
    <div className={`wrap paper-page ${mini ? "has-mini" : ""}`}>
      <TopBar />

      <div className="paper-grid">
        <div className="stage-col">
          <header className="paper-head">
            <p className="paper-source">
              {meta.source === "arxiv" ? (
                <a href={`https://arxiv.org/abs/${meta.id}`} target="_blank" rel="noopener">
                  arXiv {meta.id}
                </a>
              ) : (
                <span>Your PDF, visible only to you</span>
              )}
              {year ? <span>{year}</span> : null}
              {meta.categories?.slice(0, 3).map((c) => <span key={c}>{c}</span>)}
            </p>
            <h1 className="paper-title">{meta.title}</h1>
            {meta.authors.length ? <p className="paper-authors">{meta.authors.join(", ")}</p> : null}
          </header>
          <div className="style-switch" role="radiogroup" aria-label="Whiteboard style">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={activeTheme === t.id} className={`style-opt style-${t.id}`} onClick={() => setTheme(t.id)}>
                <span className="style-swatch" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
          <div className="stage-slot" ref={stageSlot} style={mini && slotHeight ? { height: slotHeight } : undefined}>
            <Whiteboard
              engine={engine}
              voiceOn={voiceOn}
              toggleVoice={toggleVoice}
              theme={activeTheme}
              paperSlug={slug}
              label={boardLabel}
              onBack={track.kind === "live" ? () => playOverview(false) : undefined}
              onStart={ov === "loading" ? () => {} : track.kind === "overview" && ov === "none" ? () => startOverview(true) : undefined}
              onPlayStart={() => {
                if (track.kind === "overview") addCard({ id: newId(), kind: "overview" });
              }}
              startLabel="Play the overview"
              sectionTitle={sectionTitle}
              onCite={goToSection}
              onFigure={(fig) => {
                engine?.pause();
                const f = state.ingest?.figures.find((x) => x.id === fig);
                setLightbox({ src: `/api/papers/${slug}/figures/${fig}`, caption: f?.caption ?? "" });
              }}
              mini={mini}
              onExpand={() => stageSlot.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />
          </div>
          {tutorError ? <p className="error tutor-error">{tutorError}</p> : null}
          {track.kind === "overview" && ov === "none" && me === null ? (
            <p className="overview-note">Nobody has watched this paper yet. Sign in to play it first; after that it plays for everyone.</p>
          ) : null}
        </div>

        <aside className="side-col" aria-label="This session and the paper">
          <div className="side-tabs" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={tab === "session"} onClick={() => setTab("session")}>
              This session
            </button>
            <button type="button" role="tab" aria-selected={tab === "paper"} onClick={() => setTab("paper")}>
              Sections
            </button>
          </div>

          <div className="side-scroll">
            {tab === "session" ? (
              <SessionHistory items={history} currentId={currentId} onReplay={replay} sectionTitle={sectionTitle} onCite={goToSection} />
            ) : (
              <div className="paper-map">
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
                        {isUploadId(meta.id) ? " The map stays private, like your PDF." : " Everyone who opens this paper after you gets the map for free."}
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
                              <button type="button" className="mini-btn" onClick={() => deepDive(s.id, s.title)}>
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
                                <button type="button" className="mini-btn" onClick={() => explainEq(eq.id, shortLabel(eq.meaning))}>
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
                            <button type="button" className="mini-btn" onClick={() => explainFig(f.id)}>
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
              </div>
            )}
          </div>

          <div className="ask-dock">
            <AskBox onAsk={(q, m) => void ask(q, m)} busy={asking} signedIn={Boolean(me)} />
          </div>
        </aside>
      </div>
      {lightbox ? <Lightbox src={lightbox.src} caption={lightbox.caption} onClose={closeLightbox} /> : null}
    </div>
  );
}

const shortLabel = (s: string) => {
  const plain = s.replace(/\$[^$]*\$/g, "").replace(/\s+/g, " ").trim();
  const words = plain.split(" ");
  return words.length > 7 ? `${words.slice(0, 7).join(" ")}…` : plain;
};

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
