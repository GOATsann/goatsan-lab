"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { PlayerEngine, type Clip } from "@/lib/player/engine";
import type { DrawStep, SceneList } from "@/lib/scenes/types";
import type { ThemeName } from "@/lib/types";
import { idToSlug } from "@/lib/arxivId";
import { signInHref } from "@/lib/client/useMe";
import { Board, FigureClick } from "./Board";
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
  paperSlug?: string;
  onStart?: () => void; // the big play button (e.g. to start writing an overview); default: play
  startLabel?: string;
  sectionTitle?: (id: string) => string | undefined;
  onCite?: (id: string) => void;
  onFigure?: (fig: string, caption?: string) => void;
  label?: string; // what is playing, shown on the board ("Overview", "Deep dive: Method"...)
  onBack?: () => void; // shown on the board when it isn't the overview
  onPlayStart?: () => void; // the big play button was pressed (before it plays)
  mini?: boolean; // shrunk into a bar pinned to the top (phones, while scrolling the history)
  onExpand?: () => void;
};

export function Whiteboard({ engine, voiceOn, toggleVoice, theme, paperSlug, onStart, startLabel, sectionTitle, onCite, onFigure, label, onBack, onPlayStart, mini, onExpand }: Props) {
  const onKey = (ev: React.KeyboardEvent) => {
    if (!engine || (ev.target as HTMLElement).closest("input, textarea, button")) return;
    if (ev.key === " " || ev.key === "k") {
      ev.preventDefault();
      engine.toggle();
    } else if (ev.key === "ArrowRight") engine.next();
    else if (ev.key === "ArrowLeft") engine.prev();
    else if (ev.key === "v") toggleVoice();
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
  // Drawing that stays from earlier scenes (keep), and the scene being wiped away.
  const base: DrawStep[] = [];
  for (let k = i; k > 0 && scenes[k]?.keep; k--) base.unshift(...scenes[k - 1].draw);
  const prev = i > 0 && !scene.keep ? scenes[i - 1].draw : [];
  const fade = prev.length ? Math.max(0, 1 - engine.time / 0.45) : 0;
  const prevCamera = prev.filter((s) => s.t === "camera");
  // Before the first play, show the opening scene fully drawn behind the play button.
  const idle = !engine.playing && engine.time === 0 && i === 0 && !engine.ended;
  const timings = idle
    ? scene.draw.map((s) => ({ start: 0, dur: 1, items: s.t === "steps" ? s.items.map(() => 0) : undefined }))
    : engine.timings();
  const cites = (scene.cite ?? []).map((c) => ({ id: c, title: sectionTitle?.(c) ?? c }));
  const real = scenes.filter((s) => !s.pending).length;

  return (
    <div className={`player theme-${theme} ${mini ? "is-mini" : ""}`} tabIndex={0} onKeyDown={onKey} aria-label={`Whiteboard: ${list.title}`}>
      <div className="player-stage" onClick={mini ? onExpand : undefined}>
        {label && !mini ? (
          <div className="board-label">
            <span>{label}</span>
            {onBack ? (
              <button type="button" onClick={onBack}>
                Back to the overview
              </button>
            ) : null}
          </div>
        ) : null}
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
        {idle ? (
          <button
            type="button"
            className="big-play"
            onClick={() => {
              onPlayStart?.();
              if (onStart) onStart();
              else engine.play();
            }}
            aria-label={startLabel ?? "Play"}
          >
            <span className="big-play-pill">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
              {startLabel ?? "Play the overview"}
            </span>
          </button>
        ) : null}
        {engine.playing && engine.buffering ? (
          <div className="buffering">{engine.waiting ? "The tutor is writing the next scene…" : "Getting the voice ready…"}</div>
        ) : null}
      </div>

      {mini ? (
        <div className="mini-bar">
          <button type="button" className="mini-label" onClick={onExpand}>
            <span>{label ?? list.title}</span>
            <span className="mini-caption">{engine.caption || list.title}</span>
          </button>
          <button
            type="button"
            className="ctl ctl-main"
            onClick={() => (idle && onStart ? (onPlayStart?.(), onStart()) : (idle && onPlayStart?.(), engine.toggle()))}
            aria-label={engine.playing ? "Pause" : "Play"}
          >
            {engine.playing ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            )}
          </button>
        </div>
      ) : null}
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

      <div className="controls">
        <button type="button" className="ctl" onClick={() => engine.prev()} aria-label="Previous scene">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 5h2v14H6zM20 5.5v13L9.5 12z" />
          </svg>
        </button>
        <button
          type="button"
          className="ctl ctl-main"
          onClick={() => {
            if (idle) onPlayStart?.();
            if (idle && onStart) onStart();
            else engine.toggle();
          }}
          aria-label={engine.playing ? "Pause" : "Play"}
        >
          {engine.playing ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>
        <button type="button" className="ctl" onClick={() => engine.next()} aria-label="Next scene" disabled={i >= scenes.length - 1}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M16 5h2v14h-2zM4 5.5v13L14.5 12z" />
          </svg>
        </button>

        <div className="scenes" role="group" aria-label="Scenes">
          {scenes.map((s, k) => (
            <button
              type="button"
              key={k}
              className={`scene-seg ${s.pending ? "is-pending" : ""}`}
              onClick={() => !s.pending && engine.goto(k)}
              aria-label={s.pending ? "Being written" : `Scene ${k + 1}`}
              aria-current={k === i ? "step" : undefined}
            >
              <span style={{ transform: `scaleX(${k < i ? 1 : k === i ? engine.progress : 0})` }} />
            </button>
          ))}
        </div>
        <span className="scene-count">
          {Math.min(i + 1, real)} / {real}
        </span>

        <button type="button" className={`ctl ctl-voice ${voiceOn ? "is-on" : ""}`} onClick={toggleVoice} aria-pressed={voiceOn} aria-label={voiceOn ? "Turn the voice off" : "Turn the voice on"}>
          {voiceOn ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

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
