"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PlayerEngine, type Clip } from "@/lib/player/engine";
import type { DrawStep, SceneList } from "@/lib/scenes/types";
import type { ThemeName } from "@/lib/types";
import { idToSlug } from "@/lib/arxivId";
import { signInHref } from "@/lib/client/useMe";
import { Board, FigureClick } from "./Board";
import { SettingsPanel } from "./Settings";
import { ChevronLeft, Maximize, MessageSquare, Minimize, Pause, Play, Settings, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import "./player.css";

// The whiteboard player: draws and voices a scene list. Play, pause, skip scenes, voice on or off.
// Keyboard (when the player has focus): space plays or pauses, arrows skip scenes, V toggles the voice.
// The page owns the engine (usePlayer), so it can switch tracks and insert answers while it plays.

const VOICE_KEY = "pt-voice";

// A stable key per scene object, so a scene's drawing keeps its elements while the list around it changes.
const sceneKeys = new WeakMap<object, number>();
let nextKey = 1;
const keyOf = (o: object) => {
  let k = sceneKeys.get(o);
  if (!k) sceneKeys.set(o, (k = nextKey++));
  return k;
};

async function loadSentence(sentence: string): Promise<Clip> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sentence, voice: "coral" }),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => null))?.error ?? `Voice failed (${res.status})`;
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const seconds = await new Promise<number>((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 3);
    a.onerror = () => reject(new Error("Couldn't play the voice."));
    a.src = url;
  });
  return { url, seconds };
}

// One engine for the page's lifetime; re-renders on every frame while it plays.
export function usePlayer(initial: SceneList) {
  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [voiceOn, setVoiceOn] = useState(true);
  useEffect(() => {
    // Voice: ?voice=off in the URL (handy for testing, costs nothing), else the last choice, else on.
    const fromUrl = new URLSearchParams(location.search).get("voice");
    let on = true;
    try {
      on = fromUrl ? fromUrl !== "off" : localStorage.getItem(VOICE_KEY) !== "off";
    } catch {}
    setVoiceOn(on);
    const e = new PlayerEngine({ ...initial, scenes: [...initial.scenes] }, loadSentence, on);
    // Tests read the player's state (audio muted, position, speed) from here; never in a production build.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __ptEngine?: PlayerEngine }).__ptEngine = e;
    const off = e.subscribe(rerender);
    setEngine(e);
    return () => {
      off();
      e.destroy();
    };
    // The engine lives as long as the page; later lists go through engine.load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleVoice = useCallback(() => {
    if (!engine) return;
    const on = !engine.voice;
    engine.setVoice(on);
    setVoiceOn(on);
    try {
      localStorage.setItem(VOICE_KEY, on ? "on" : "off");
    } catch {}
  }, [engine]);
  return { engine, voiceOn, toggleVoice };
}

type Props = {
  engine: PlayerEngine | null;
  voiceOn: boolean;
  toggleVoice: () => void;
  theme: ThemeName;
  onTheme?: (t: ThemeName) => void; // offered in the settings menu when given
  paperSlug?: string;
  onStart?: () => void; // the big play button (e.g. to start writing an overview); default: play
  startLabel?: string;
  sectionTitle?: (id: string) => string | undefined;
  onCite?: (id: string) => void;
  onFigure?: (fig: string, caption?: string) => void;
  label?: string; // what is playing, shown on the board ("Overview", "Deep dive: Method"...)
  onBack?: () => void; // shown on the board when it isn't the overview
  onPlayStart?: () => void; // the big play button was pressed (before it plays)
  action?: { label: string; onClick: () => void }; // one clear call to action on the board ("Resume overview")
  onAsk?: () => void; // the Ask button in the control bar (leaves full screen first)
  overlay?: React.ReactNode; // shown over the board instead of the play button (the paper is still opening)
};


// Like a video player: the controls sit inside the frame, at the bottom, and hide while it plays; a tap or a
// mouse move brings them back.
export function Whiteboard({ engine, voiceOn, toggleVoice, theme, onTheme, paperSlug, onStart, startLabel, sectionTitle, onCite, onFigure, label, onBack, onPlayStart, action, onAsk, overlay }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);
  const [menu, setMenu] = useState(false);
  const [fs, setFs] = useState<"off" | "native" | "css">("off");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playing = Boolean(engine?.playing);

  // Auto-hide: visible while paused or the menu is open; hidden 2.5 s after the last touch while playing.
  const poke = useCallback(() => {
    setShown(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShown(false), 2500);
  }, []);
  useEffect(() => {
    if (!playing || menu) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setShown(true);
    } else poke();
  }, [playing, menu, poke]);
  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), []);

  // Fullscreen: the browser's when it can do it for the frame, else a fixed full-window view (iPhone Safari).
  useEffect(() => {
    const on = () => setFs(document.fullscreenElement ? "native" : (f) => (f === "native" ? "off" : f));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFs = () => {
    const el = frame.current;
    if (fs === "native") void document.exitFullscreen?.();
    else if (fs === "css") setFs("off");
    else if (el?.requestFullscreen && document.fullscreenEnabled) void el.requestFullscreen().catch(() => setFs("css"));
    else setFs("css");
  };
  // While full screen, the page around the player (question box, tabs, account button) steps aside.
  useEffect(() => {
    document.documentElement.classList.toggle("pt-fullscreen", fs !== "off");
    return () => document.documentElement.classList.remove("pt-fullscreen");
  }, [fs]);
  const askFromPlayer = () => {
    // Leave full screen synchronously (so the question box can take focus inside this tap), then hand over.
    document.documentElement.classList.remove("pt-fullscreen");
    setMenu(false);
    if (fs === "native" && document.fullscreenElement) {
      // The browser's own full screen ends asynchronously; the box can only take focus after it has.
      void document.exitFullscreen().then(() => onAsk?.(), () => onAsk?.());
      return;
    }
    setFs("off");
    onAsk?.();
  };
  useEffect(() => {
    if (fs !== "css") return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFs("off");
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [fs]);

  const onKey = (ev: React.KeyboardEvent) => {
    if (!engine || (ev.target as HTMLElement).closest("input, textarea, button")) return;
    poke();
    if (ev.key === " " || ev.key === "k") {
      ev.preventDefault();
      engine.toggle();
    } else if (ev.key === "ArrowRight") engine.next();
    else if (ev.key === "ArrowLeft") engine.prev();
    else if (ev.key === "v") toggleVoice();
    else if (ev.key === "f") toggleFs();
  };

  const list = engine?.list;
  const paper = paperSlug ?? (list?.paper ? idToSlug(list.paper) : null);
  const figureSrc = useCallback((fig: string) => (paper ? `/api/papers/${paper}/figures/${fig}` : null), [paper]);

  if (!engine || !list) {
    return (
      <div className={`player theme-${theme}`}>
        <div className="player-stage">
          <div className="board" />
        </div>
      </div>
    );
  }

  const i = engine.sceneIndex;
  const scenes = list.scenes;
  const scene = engine.scene;
  const base: DrawStep[] = [];
  for (let k = i; k > 0 && scenes[k]?.keep; k--) base.unshift(...scenes[k - 1].draw);
  const prev = i > 0 && !scene.keep ? scenes[i - 1].draw : [];
  const fade = prev.length ? Math.max(0, 1 - engine.time / 0.45) : 0;
  const prevCamera = prev.filter((st) => st.t === "camera");
  const idle = !engine.playing && engine.time === 0 && i === 0 && !engine.ended;
  const timings = idle
    ? scene.draw.map((st) => ({ start: 0, dur: 1, items: st.t === "steps" ? st.items.map(() => 0) : undefined }))
    : engine.timings();
  const cites = (scene.cite ?? []).map((c) => ({ id: c, title: sectionTitle?.(c) ?? c }));
  const real = scenes.filter((x) => !x.pending && !x.backdrop).length;
  const shownIndex = Math.max(0, i - scenes.slice(0, i).filter((x) => x.backdrop).length);
  const start = () => {
    onPlayStart?.();
    if (onStart) onStart();
    else engine.play();
  };
  const togglePlay = () => (idle ? start() : engine.toggle());
  const controlsVisible = shown || !playing || menu;

  return (
    <div className={`player theme-${theme} ${fs !== "off" ? "is-fullscreen" : ""} ${fs === "css" ? "is-css-fs" : ""}`} tabIndex={0} onKeyDown={onKey} aria-label={`Whiteboard: ${list.title}`}>
      <div
        ref={frame}
        className={`player-stage ${controlsVisible ? "controls-on" : "controls-off"}`}
        onPointerMove={(e) => e.pointerType === "mouse" && poke()}
        onPointerDown={(e) => {
          // A tap on the board shows the controls (or hides them, if they are showing while it plays).
          if ((e.target as HTMLElement).closest(".pbar, .board-label, .big-play, .board-action, .settings, .el-figure")) return;
          if (e.pointerType !== "mouse" && controlsVisible && playing && !menu) setShown(false);
          else poke();
        }}
      >
        <div className="frame">
        <FigureClick.Provider value={onFigure ?? null}>
          <Board
            steps={scene.draw}
            timings={timings}
            time={idle ? 1e6 : engine.time}
            base={base}
            fading={prev}
            fade={fade}
            prevCamera={prevCamera}
            figureSrc={figureSrc}
            sceneKey={`s${keyOf(scene)}`}
          />
        </FigureClick.Provider>
        {label ? (
          <div className={`board-label ${controlsVisible ? "" : "is-faded"}`}>
            <span>{label}</span>
            {onBack ? (
              <button type="button" onClick={onBack}>
                <ChevronLeft size={14} strokeWidth={2.2} aria-hidden />
                Back to the overview
              </button>
            ) : null}
          </div>
        ) : null}
        {overlay && !playing ? overlay : idle ? (
          <button type="button" className="big-play" onClick={start} aria-label={startLabel ?? "Play"}>
            <span className="big-play-pill">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
              {startLabel ?? "Play the overview"}
            </span>
          </button>
        ) : null}
        {action && !engine.playing ? (
          <button type="button" className="board-action" onClick={action.onClick}>
            <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden />
            {action.label}
          </button>
        ) : null}
        {engine.playing && engine.buffering ? (
          <div className="buffering">{engine.waiting ? "The tutor is writing the next scene…" : "Getting the voice ready…"}</div>
        ) : null}
        {engine.caption ? <p className="frame-caption">{engine.caption}</p> : null}

        {!idle ? (
          <div className="pbar" aria-hidden={!controlsVisible} inert={!controlsVisible}>
            <div className="pbar-scenes" role="group" aria-label="Scenes">
              {scenes.map((sc, k) => (sc.backdrop ? null : (
                <button
                  type="button"
                  key={k}
                  className={`pbar-seg ${sc.pending ? "is-pending" : ""}`}
                  onClick={() => !sc.pending && (engine.goto(k), poke())}
                  aria-label={sc.pending ? "Being written" : `Scene ${k + 1}`}
                  aria-current={k === i ? "step" : undefined}
                >
                  <span style={{ transform: `scaleX(${k < i ? 1 : k === i ? engine.progress : 0})` }} />
                </button>
              )))}
            </div>
            <div className="pbar-row">
              <button type="button" className="pbtn" onClick={() => (engine.prev(), poke())} aria-label="Previous scene">
                <SkipBack size={18} strokeWidth={2} fill="currentColor" />
              </button>
              <button type="button" className="pbtn pbtn-main" onClick={() => (togglePlay(), poke())} aria-label={engine.playing ? "Pause" : "Play"}>
                {engine.playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
              </button>
              <button type="button" className="pbtn" onClick={() => (engine.next(), poke())} aria-label="Next scene" disabled={i >= scenes.length - 1}>
                <SkipForward size={18} strokeWidth={2} fill="currentColor" />
              </button>
              <span className="pbar-count">
                {Math.min(shownIndex + 1, real)} / {real}
              </span>
              <span className="pbar-spacer" />
              {onAsk ? (
                <button type="button" className="pbtn" onClick={askFromPlayer} aria-label="Ask a question">
                  <MessageSquare size={18} strokeWidth={2} />
                </button>
              ) : null}
              <button type="button" className="pbtn" onClick={() => (toggleVoice(), poke())} aria-label={voiceOn ? "Mute the voice" : "Turn the voice on"} aria-pressed={!voiceOn}>
                {voiceOn ? <Volume2 size={19} strokeWidth={2} /> : <VolumeX size={19} strokeWidth={2} />}
              </button>
              <button type="button" className="pbtn" onClick={() => setMenu((m) => !m)} aria-label="Settings" aria-expanded={menu}>
                <Settings size={19} strokeWidth={2} />
              </button>
              <button type="button" className="pbtn" onClick={toggleFs} aria-label={fs === "off" ? "Full screen" : "Exit full screen"}>
                {fs === "off" ? <Maximize size={18} strokeWidth={2} /> : <Minimize size={18} strokeWidth={2} />}
              </button>
            </div>
          </div>
        ) : null}

        </div>
        {menu ? (
          <SettingsPanel
            onClose={() => setMenu(false)}
            theme={theme}
            onTheme={onTheme}
            speed={engine.speed}
            onSpeed={(v) => engine.setSpeed(v)}
            voiceOn={voiceOn}
            onVoice={(on) => on !== voiceOn && toggleVoice()}
            inside={fs !== "off" ? frame.current : null}
          />
        ) : null}
      </div>

      <p className="caption" aria-live="polite">
        {engine.caption || <span className="caption-idle">{list.title}</span>}
      </p>
      {cites.length && !idle ? (
        <p className="cite-line">
          From the paper:{" "}
          {cites.map((c) => (
            <button key={c.id} type="button" className="cite-chip" onClick={() => onCite?.(c.id)}>
              {c.title}
            </button>
          ))}
        </p>
      ) : null}

      {voiceOn && engine.voiceError ? (
        <p className="voice-note">
          {engine.voiceError.startsWith("Sign in") ? (
            <>
              The voice is for signed-in viewers, so this plays with captions.{" "}
              <a
                href="#sign-in"
                onClick={(e) => {
                  e.preventDefault();
                  location.assign(signInHref());
                }}
              >
                Sign in
              </a>
            </>
          ) : (
            <>The voice couldn&apos;t load ({engine.voiceError}), so this plays with captions.</>
          )}
        </p>
      ) : null}
    </div>
  );
}
