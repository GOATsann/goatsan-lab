"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Play, Presentation } from "lucide-react";
import type { Scene } from "@/lib/scenes/types";
import { renderRich } from "@/components/player/math";

// The session history: everything that played on the board and everything asked, in order. Tapping a card
// plays it again. The question box stays at the bottom.

export type HistoryItem =
  | { id: string; kind: "overview" }
  | { id: string; kind: "deepdive"; section: string; label: string }
  | { id: string; kind: "explain"; eq?: string; fig?: string; label: string }
  | {
      id: string;
      kind: "ask";
      question: string;
      mode: "board" | "text";
      answer: string;
      cites: string[];
      scenes?: Scene[];
      pending?: boolean;
      error?: string;
    };

export type AskMode = "board" | "text";

type Props = {
  items: HistoryItem[];
  currentId: string | null;
  onReplay: (item: HistoryItem) => void;
  onAsk: (question: string, mode: AskMode) => void;
  busy: boolean;
  signedIn: boolean;
  sectionTitle: (id: string) => string | undefined;
  onCite: (id: string) => void;
};

export function SessionHistory({ items, currentId, onReplay, sectionTitle, onCite }: Omit<Props, "onAsk" | "busy" | "signedIn">) {
  const end = useRef<HTMLDivElement>(null);
  const count = items.length;
  const lastText = items[items.length - 1]?.kind === "ask" ? (items[items.length - 1] as { answer: string }).answer.length : 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [count, lastText]);

  if (!items.length) {
    return (
      <div className="history-empty">
        <p>Play the overview, open a deep dive from Sections, or ask a question. Everything you watch and ask shows up here, and you can play it again.</p>
      </div>
    );
  }
  return (
    <ol className="history" aria-label="This session">
      {items.map((it) => {
        const current = it.id === currentId;
        if (it.kind !== "ask") {
          const text = it.kind === "overview" ? "Overview" : it.label;
          return (
            <li key={it.id}>
              <button type="button" className={`play-card ${current ? "is-current" : ""}`} onClick={() => onReplay(it)} aria-current={current || undefined}>
                <Play aria-hidden size={16} strokeWidth={2} />
                <span>{text}</span>
              </button>
            </li>
          );
        }
        return (
          <li key={it.id} className="qa">
            <p className="you-asked">
              <span className="visually-hidden">You asked: </span>
              {it.question}
            </p>
            {it.error ? (
              <p className="error">{it.error}</p>
            ) : (
              <>
                {it.answer || it.pending ? (
                  <div className="answer">
                    <MessageSquareText aria-hidden size={16} strokeWidth={2} className="answer-icon" />
                    <AnswerText text={it.answer || "…"} sectionTitle={sectionTitle} onCite={onCite} />
                  </div>
                ) : null}
                {it.mode === "board" ? (
                  <button
                    type="button"
                    className={`play-card ${current ? "is-current" : ""}`}
                    onClick={() => it.scenes?.length && onReplay(it)}
                    disabled={it.pending || !it.scenes?.length}
                  >
                    <Presentation aria-hidden size={16} strokeWidth={2} />
                    <span>{it.pending ? "Making the video answer…" : "Played as video"}</span>
                  </button>
                ) : null}
                <Cites cites={it.cites} sectionTitle={sectionTitle} onCite={onCite} />
              </>
            )}
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}

function Cites({ cites, sectionTitle, onCite }: { cites: string[]; sectionTitle: (id: string) => string | undefined; onCite: (id: string) => void }) {
  if (!cites.length) return null;
  return (
    <p className="cite-line">
      From the paper:{" "}
      {cites.map((c) => (
        <button key={c} type="button" className="cite-chip" onClick={() => onCite(c)}>
          {sectionTitle(c) ?? c}
        </button>
      ))}
    </p>
  );
}

// Text with [[section-id]] citations turned into links to the section.
function AnswerText({ text, sectionTitle, onCite }: { text: string; sectionTitle: (id: string) => string | undefined; onCite: (id: string) => void }) {
  return (
    <div className="answer-text">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>
          {para.split(/\[\[([^\]]{1,80})\]\]/g).map((part, k) =>
            k % 2 === 1 ? (
              sectionTitle(part) ? (
                <button key={k} type="button" className="cite-chip" onClick={() => onCite(part)}>
                  {sectionTitle(part)}
                </button>
              ) : (
                <span key={k} className="cite-chip is-static">
                  {part}
                </span>
              )
            ) : (
              <span key={k} dangerouslySetInnerHTML={{ __html: renderRich(part) }} />
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export function AskBox({ onAsk, busy, signedIn }: Pick<Props, "onAsk" | "busy" | "signedIn">) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<AskMode>("board");
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    onAsk(question, mode);
    setQ("");
  };
  return (
    <form className="ask" onSubmit={submit}>
      <div className="answer-mode" role="radiogroup" aria-label="Answer">
        <button type="button" role="radio" aria-checked={mode === "board"} onClick={() => setMode("board")}>
          As video
        </button>
        <button type="button" role="radio" aria-checked={mode === "text"} onClick={() => setMode("text")}>
          As text
        </button>
      </div>
      <div className="ask-row">
        <label htmlFor="ask-q" className="visually-hidden">
          Ask about this paper
        </label>
        <textarea
          id="ask-q"
          rows={1}
          value={q}
          placeholder={signedIn ? "Ask about this paper" : "Sign in to ask about this paper"}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="btn btn-pen" disabled={busy || !q.trim()}>
          {busy ? "Answering…" : "Ask"}
        </button>
      </div>
    </form>
  );
}
