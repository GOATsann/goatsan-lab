// Sound (effects) and Music switches, independent and remembered. Shown as labelled buttons on the
// card (if the page has #sound / #music) and as two small icons in a corner during play.
// M (desktop) is a master mute: both off, or both back on.
import type { Sfx } from "./audio";

const store = {
  get: (k: string) => { try { return localStorage.getItem(`lights-out:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`lights-out:${k}`, v); } catch { /* private mode */ } },
};

const ICON = {
  sound: (on: boolean) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${on
    ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    : '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`,
  music: (on: boolean) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17V5l10-2v12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="17" r="3" fill="currentColor"/><circle cx="17" cy="15" r="3" fill="currentColor"/>${on
    ? "" : '<path d="M3 3l18 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'}</svg>`,
};

export function mountSoundControls(sfx: Sfx, isTyping: () => boolean = () => false): void {
  sfx.setMuted(store.get("muted") === "1");
  sfx.setMusic(store.get("music") !== "0");
  const corner = document.createElement("div");
  corner.className = "audioctl";
  corner.innerHTML = '<button data-k="sound"></button><button data-k="music"></button>';
  document.body.appendChild(corner);

  const buttons = [...document.querySelectorAll<HTMLButtonElement>("#sound, #music, .audioctl button")];
  const kind = (b: HTMLButtonElement) => (b.id || b.dataset.k) as "sound" | "music";
  function show(): void {
    for (const b of buttons) {
      const k = kind(b), on = k === "sound" ? !sfx.muted : sfx.musicOn, label = `${k === "sound" ? "Sound" : "Music"} ${on ? "on" : "off"}`;
      b.innerHTML = ICON[k](on) + (b.closest(".audioctl") ? "" : `<span>${label}</span>`);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", label);
      b.title = label;
    }
  }
  function set(k: "sound" | "music", on: boolean): void {
    sfx.unlock();
    if (k === "sound") { sfx.setMuted(!on); store.set("muted", on ? "0" : "1"); }
    else { sfx.setMusic(on); store.set("music", on ? "1" : "0"); }
    show();
  }
  for (const b of buttons) b.addEventListener("click", (e) => {
    e.stopPropagation();
    const k = kind(b);
    set(k, k === "sound" ? sfx.muted : !sfx.musicOn);
  });
  // stop taps on the corner icons from also counting as a swipe or a "start"
  corner.addEventListener("pointerdown", (e) => e.stopPropagation());
  corner.addEventListener("pointerup", (e) => e.stopPropagation());
  window.addEventListener("keydown", (e) => {
    if ((e.key === "m" || e.key === "M") && !isTyping()) {
      const anyOn = !sfx.muted || sfx.musicOn;
      set("sound", !anyOn);
      set("music", !anyOn);
    }
  });
  // Safari grants audio on finished taps and clicks (not pointerdown); also come back after a screen
  // lock or a tab switch, which can leave the audio "interrupted" or suspended
  for (const ev of ["pointerup", "touchend", "click", "keydown"]) window.addEventListener(ev, () => sfx.unlock(), { capture: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sfx.unlock(); });
  window.addEventListener("pageshow", () => sfx.unlock());
  window.addEventListener("focus", () => sfx.unlock()); // back from laptop sleep or another window
  show();
}
