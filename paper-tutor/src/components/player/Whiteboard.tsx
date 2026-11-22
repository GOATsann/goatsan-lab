"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PlayerEngine, type Clip } from "@/lib/player/engine";
import type { DrawStep, SceneList } from "@/lib/scenes/types";
import type { ThemeName } from "@/lib/types";
import { idToSlug } from "@/lib/arxivId";
import { signInHref } from "@/lib/client/useMe";
import { Board } from "./Board";
import "./player.css";

// The whiteboard player: draws and voices a scene list. Play, pause, skip scenes, voice on or off.
// Keyboard (when the player has focus): space plays or pauses, arrows skip scenes, V toggles the voice.

const VOICE_KEY = "pt-voice";

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

export function Whiteboard({ list, theme, paperSlug }: { list: SceneList; theme: ThemeName; paperSlug?: string }) {
  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const root = useRef<HTMLDivElement>(null);
  const [voiceOn, setVoiceOn] = useState(true);

  useEffect(() => {
    // Voice: ?voice=off in the URL (handy for testing, costs nothing), else the last choice, else on.
    const fromUrl = new URLSearchParams(location.search).get("voice");
    let on = true;
    try {
      on = fromUrl ? fromUrl !== "off" : localStorage.getItem(VOICE_KEY) !== "off";
    } catch {}
    setVoiceOn(on);
    const e = new PlayerEngine(list, loadSentence, on);
    const off = e.subscribe(rerender);
    setEngine(e);
    return () => {
      off();
      e.destroy();
    };
  }, [list]);

  const toggleVoice = useCallback(() => {
    if (!engine) return;
    const on = !engine.voice;
    engine.setVoice(on);
    setVoiceOn(on);
    try {
      localStorage.setItem(VOICE_KEY, on ? "on" : "off");
    } catch {}
  }, [engine]);

  const onKey = (ev: React.KeyboardEvent) => {
    if (!engine) return;
    if (ev.key === " " || ev.key === "k") {
      ev.preventDefault();
      engine.toggle();
    } else if (ev.key === "ArrowRight") engine.next();
    else if (ev.key === "ArrowLeft") engine.prev();
    else if (ev.key === "v") toggleVoice();
  };

  const paper = paperSlug ?? (list.paper ? idToSlug(list.paper) : null);
  const figureSrc = useCallback((fig: string) => (paper ? `/api/papers/${paper}/figures/${fig}` : null), [paper]);

  if (!engine) return <div className={`player theme-${theme}`}><div className="board" /></div>;

  const i = engine.sceneIndex;
  const scenes = list.scenes;
  const scene = scenes[i];
  // Drawing that stays from earlier scenes (keep), and the scene being wiped away.
  const base: DrawStep[] = [];
  for (let k = i; k > 0 && scenes[k].keep; k--) base.unshift(...scenes[k - 1].draw);
  const prev = i > 0 && !scene.keep ? scenes[i - 1].draw : [];
  const fade = prev.length ? Math.max(0, 1 - engine.time / 0.45) : 0;
  const prevCamera = prev.filter((s) => s.t === "camera");
  // Before the first play, show the opening scene fully drawn behind the play button.
  const idle = !engine.playing && engine.time === 0 && i === 0 && !engine.ended;
  const timings = idle
    ? scene.draw.map((s) => ({ start: 0, dur: 1, items: s.t === "steps" ? s.items.map(() => 0) : undefined }))
    : engine.timings();

  return (
    <div className={`player theme-${theme}`} ref={root} tabIndex={0} onKeyDown={onKey} aria-label={`Whiteboard: ${list.title}`}>
      <div className="player-stage">
        <Board
          steps={scene.draw}
          timings={timings}
          time={idle ? 1e6 : engine.time}
          base={base}
          fading={prev}
          fade={fade}
          prevCamera={prevCamera}
          figureSrc={figureSrc}
          sceneKey={`s${i}`}
        />
        {idle ? (
          <button type="button" className="big-play" onClick={() => engine.play()} aria-label="Play">
            <span className="big-play-pill">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
              Play the overview
            </span>
          </button>
        ) : null}
        {engine.buffering ? <div className="buffering">Getting the voice ready…</div> : null}
      </div>

      <p className="caption" aria-live="polite">
        {engine.caption || <span className="caption-idle">{list.title}</span>}
      </p>

      <div className="controls">
        <button type="button" className="ctl" onClick={() => engine.prev()} aria-label="Previous scene">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 5h2v14H6zM20 5.5v13L9.5 12z" />
          </svg>
        </button>
        <button type="button" className="ctl ctl-main" onClick={() => engine.toggle()} aria-label={engine.playing ? "Pause" : "Play"}>
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
          {scenes.map((_, k) => (
            <button
              type="button"
              key={k}
              className="scene-seg"
              onClick={() => engine.goto(k)}
              aria-label={`Scene ${k + 1}`}
              aria-current={k === i ? "step" : undefined}
            >
              <span style={{ transform: `scaleX(${k < i ? 1 : k === i ? engine.progress : 0})` }} />
            </button>
          ))}
        </div>
        <span className="scene-count">
          {i + 1} / {scenes.length}
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
              <a href="#sign-in" onClick={(e) => { e.preventDefault(); location.assign(signInHref()); }}>
                Sign in
              </a>
            </>
          ) : (
            <>The voice couldn't load ({engine.voiceError}), so this plays with captions.</>
          )}
        </p>
      ) : null}
    </div>
  );
}
