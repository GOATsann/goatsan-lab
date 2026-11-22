"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePlayer, Whiteboard } from "@/components/player/Whiteboard";
import { handWritten } from "@/lib/scenes";
import { THEMES, type ThemeName } from "@/lib/types";
import "@/components/paper/paper.css";

// A hand-written walkthrough of "Attention Is All You Need", with every drawing tool. No AI involved.
export function DemoPlayer() {
  const { engine, voiceOn, toggleVoice } = usePlayer({ title: "", scenes: [{ say: "", draw: [] }] });
  const [theme, setTheme] = useState<ThemeName>("diagram");
  useEffect(() => {
    const list = handWritten("1706.03762");
    if (engine && list) engine.load(list);
  }, [engine]);
  return (
    <div className="wrap">
      <header className="topbar">
        <Link href="/" className="wordmark">
          Paper Tutor
        </Link>
        <Link href="/paper/1706.03762" className="back-link">
          The paper
        </Link>
      </header>
      <header className="paper-head">
        <h1 className="paper-title">Attention Is All You Need, walked through</h1>
        <p className="paper-authors">A hand-written walkthrough of the 2017 Transformer paper.</p>
      </header>
      <div className="demo-main">
        <div className="player-bar">
          <span />
          <div className="style-switch" role="radiogroup" aria-label="Whiteboard style">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`style-opt style-${t.id}`} onClick={() => setTheme(t.id)}>
                <span className="style-swatch" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <Whiteboard engine={engine} voiceOn={voiceOn} toggleVoice={toggleVoice} theme={theme} paperSlug="1706.03762" startLabel="Play" />
      </div>
    </div>
  );
}
