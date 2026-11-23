"use client";

import { Check, Circle, LoaderCircle, Play, X } from "lucide-react";

// What the server is doing while a paper opens: live steps with counts, over the board.
export type Step = { key: string; label: string; state: "waiting" | "active" | "done" | "error" | "skipped"; detail?: string; ms?: number };
export type Progress = { steps: Step[]; error?: string };

const DEFAULT: Step[] = [
  { key: "download", label: "Downloading", state: "active" },
  { key: "pages", label: "Reading pages", state: "waiting" },
  { key: "figures", label: "Finding figures", state: "waiting" },
  { key: "map", label: "Mapping the paper", state: "waiting" },
  { key: "overview", label: "Writing the overview", state: "waiting" },
];

export function ProgressCard({ progress, title, onPlay }: { progress: Progress | null; title: string; onPlay?: () => void }) {
  // Before the first poll answers, show the steps as waiting so the card doesn't jump.
  const steps = progress?.steps ?? DEFAULT;
  return (
    <div className="progress-card" role="status" aria-live="polite">
      <p className="progress-title">{title}</p>
      <ol className="progress-steps">
        {steps.map((s) => (
          <li key={s.key} className={`pstep is-${s.state}`}>
            <span className="pstep-icon" aria-hidden>
              {s.state === "done" ? (
                <Check size={14} strokeWidth={3} />
              ) : s.state === "active" ? (
                <LoaderCircle size={14} strokeWidth={2.5} className="spin" />
              ) : s.state === "error" ? (
                <X size={14} strokeWidth={3} />
              ) : (
                <Circle size={8} strokeWidth={0} fill="currentColor" />
              )}
            </span>
            <span className="pstep-label">{s.label}</span>
            {s.detail ? <span className="pstep-detail">{s.detail}</span> : null}
          </li>
        ))}
      </ol>
      {progress?.error ? <p className="progress-error">{progress.error}</p> : null}
      {onPlay ? (
        <button type="button" className="progress-play" onClick={onPlay}>
          <Play size={14} strokeWidth={2.5} aria-hidden />
          Play the opening
        </button>
      ) : null}
    </div>
  );
}
