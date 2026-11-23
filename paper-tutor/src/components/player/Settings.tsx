"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { THEMES, type ThemeName } from "@/lib/types";

// Player settings. Every choice applies at once; there is nothing to confirm.
// Phones: a bottom sheet over a dim backdrop (tap outside, swipe down or X to close).
// Larger screens: a small popover over the gear (click outside or Esc to close).

const SPEEDS = [0.75, 1, 1.25, 1.5];

type Props = {
  onClose: () => void;
  theme: ThemeName;
  onTheme?: (t: ThemeName) => void;
  speed: number;
  onSpeed: (v: number) => void;
  voiceOn: boolean;
  onVoice: (on: boolean) => void;
};

function Rows({ theme, onTheme, speed, onSpeed, voiceOn, onVoice }: Omit<Props, "onClose">) {
  return (
    <div className="settings-rows">
      {onTheme ? (
        <div className="settings-row">
          <span>Style</span>
          <div className="seg" role="radiogroup" aria-label="Style">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} onClick={() => onTheme(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="settings-row">
        <span>Speed</span>
        <div className="seg" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={speed === v} onClick={() => onSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span>Voice</span>
        <div className="seg" role="radiogroup" aria-label="Voice">
          <button type="button" role="radio" aria-checked={voiceOn} onClick={() => onVoice(true)}>
            On
          </button>
          <button type="button" role="radio" aria-checked={!voiceOn} onClick={() => onVoice(false)}>
            Off
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel(props: Props) {
  const { onClose } = props;
  const [phone, setPhone] = useState<boolean | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const [dy, setDy] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px), (pointer: coarse) and (max-height: 500px)");
    setPhone(mq.matches);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Esc, and a click outside the popover, close it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (box.current?.contains(t) || t.closest('[aria-label="Settings"]')) return;
      onClose();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", down);
    };
  }, [onClose]);

  if (phone === null) return null;
  if (!phone) {
    return (
      <div ref={box} className="settings settings-pop" role="dialog" aria-label="Player settings">
        <Rows {...props} />
      </div>
    );
  }
  return createPortal(
    <div className="settings-backdrop">
      <div
        ref={box}
        className="settings settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Player settings"
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: drag.current ? "none" : undefined }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { y: e.clientY, dy: 0 };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          drag.current.dy = Math.max(0, e.clientY - drag.current.y);
          setDy(drag.current.dy);
        }}
        onPointerUp={() => {
          const d = drag.current?.dy ?? 0;
          drag.current = null;
          if (d > 70) onClose();
          else setDy(0);
        }}
      >
        <div className="sheet-head">
          <span className="sheet-grip" aria-hidden />
          <h2>Settings</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <Rows {...props} />
      </div>
    </div>,
    document.body,
  );
}
