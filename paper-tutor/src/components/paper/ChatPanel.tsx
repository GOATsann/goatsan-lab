"use client";

import { useRef, useState } from "react";
import type { Scene } from "@/lib/scenes/types";
import { signInHref } from "@/lib/client/useMe";
import { readText } from "@/lib/client/streams";
import { renderRich } from "@/components/player/math";

// Ask about the paper. Answers come back on the whiteboard (the board pauses, the tutor answers on it, then
// carries on) or as text. Every answer points at the section it comes from.

export type BoardAnswer = { says: string[]; cites: string[] };
type Mode = "board" | "text";
type Msg = { role: "user" | "assistant"; text: string; mode: Mode; cites?: string[]; pending?: boolean; error?: string };

type Props = {
  slug: string;
  signedIn: boolean;
  sectionTitle: (id: string) => string | undefined;
  onCite: (id: string) => void;
  askOnBoard: (q: string, history: { role: "user" | "assistant"; text: string }[], onScene: (s: Scene) => void) => Promise<BoardAnswer>;
  pausePlayer: () => void;
};

export function ChatPanel({ slug, signedIn, sectionTitle, onCite, askOnBoard, pausePlayer }: Props) {
  const [mode, setMode] = useState<Mode>("board");
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const update = (i: number, patch: Partial<Msg>) => setLog((l) => l.map((m, k) => (k === i ? { ...m, ...patch } : m)));

  const ask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    if (!signedIn) {
      location.assign(signInHref());
      return;
    }
    const history = log.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, text: m.text }));
    const at = log.length + 1;
    setLog((l) => [...l, { role: "user", text: question, mode }, { role: "assistant", text: "", mode, pending: true }]);
    setQ("");
    setBusy(true);
    try {
      if (mode === "board") {
        const said: string[] = [];
        const out = await askOnBoard(question, history, (s) => {
          said.push(s.say);
          update(at, { text: said.join(" ") });
        });
        update(at, { text: out.says.join(" ") || "(no answer)", cites: out.cites, pending: false });
      } else {
        pausePlayer();
        const text = await readText(`/api/papers/${slug}/chat`, { question, history }, (all) => update(at, { text: all }));
        update(at, { text, pending: false });
      }
    } catch (err) {
      update(at, { pending: false, error: (err as Error).message });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <section className="chat" aria-label="Ask about this paper">
      {log.length ? (
        <ol className="chat-log">
          {log.map((m, i) => (
            <li key={i} className={`msg msg-${m.role}`}>
              {m.role === "user" ? (
                <p>{m.text}</p>
              ) : m.error ? (
                <p className="error">{m.error}</p>
              ) : (
                <>
                  {m.mode === "board" ? <p className="msg-kind">{m.pending ? "Answering on the whiteboard…" : "Answered on the whiteboard"}</p> : null}
                  <Answer text={m.text || (m.pending ? "…" : "")} sectionTitle={sectionTitle} onCite={onCite} />
                  {m.cites?.length ? (
                    <p className="cite-line">
                      From the paper:{" "}
                      {m.cites.map((c) => (
                        <button key={c} type="button" className="cite-chip" onClick={() => onCite(c)}>
                          {sectionTitle(c) ?? c}
                        </button>
                      ))}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <form className="ask" onSubmit={ask}>
        <label htmlFor="ask-q" className="visually-hidden">
          Ask about this paper
        </label>
        <textarea
          id="ask-q"
          ref={input}
          rows={1}
          value={q}
          placeholder="Ask about this paper"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <div className="ask-row">
          <div className="answer-mode" role="radiogroup" aria-label="Answer as">
            <button type="button" role="radio" aria-checked={mode === "board"} onClick={() => setMode("board")}>
              On the whiteboard
            </button>
            <button type="button" role="radio" aria-checked={mode === "text"} onClick={() => setMode("text")}>
              As text
            </button>
          </div>
          <button type="submit" className="btn btn-pen" disabled={busy || !q.trim()}>
            {busy ? "Answering…" : "Ask"}
          </button>
        </div>
        {!signedIn ? <p className="read-hint">Asking needs sign-in.</p> : null}
      </form>
    </section>
  );
}

// Text with [[section-id]] citations turned into links to the section.
function Answer({ text, sectionTitle, onCite }: { text: string; sectionTitle: (id: string) => string | undefined; onCite: (id: string) => void }) {
  return (
    <div className="answer">
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
