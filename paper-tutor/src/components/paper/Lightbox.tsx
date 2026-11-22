"use client";

import { useEffect, useRef } from "react";
import { renderRich } from "@/components/player/math";

// A figure, large, over the page. Closes with the X, Esc, or a tap outside the figure. On a phone it fills the
// screen and the picture can be pinch-zoomed.
export function Lightbox({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        e.preventDefault(); // one control inside: keep focus on it
        close.current?.focus();
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={caption} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button ref={close} type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <figure className="lightbox-figure">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={caption} />
        <figcaption dangerouslySetInnerHTML={{ __html: renderRich(caption) }} />
      </figure>
    </div>
  );
}
