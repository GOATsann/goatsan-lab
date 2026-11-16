// The leaderboard API (served by the personal site; contract agreed with its backend).
// Playing never needs an account; saving a score does. If the player isn't signed in, the run is kept
// in this browser, they sign in on the main site, and it is saved automatically when they come back.
import type { Replay } from "../core/game";

const API = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://localhost:3100"
  : "https://www.theonlygoatsan.com";
const PENDING = "lights-out:pending-score";

export interface SaveResult { score: number; level: number; best: number; rank: number | null; improved: boolean }
export interface BoardEntry { rank: number; name: string; score: number; seconds: number; at: string }
export interface Board { level: number; top: BoardEntry[]; me: { best: number; rank: number | null } | null }

export type SaveOutcome =
  | { ok: true; result: SaveResult }
  | { ok: false; signIn: true }
  | { ok: false; signIn: false; message: string };

export async function saveScore(name: string, replay: Replay): Promise<SaveOutcome> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/surfer/score`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, replay }),
    });
  } catch {
    return { ok: false, signIn: false, message: "The scoreboard can't be reached right now. Please try again." };
  }
  if (r.status === 401) return { ok: false, signIn: true };
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, signIn: false, message: body.error ?? "This score couldn't be saved." };
  return { ok: true, result: body as SaveResult };
}

/** Keep the run, send the player to sign in, and come back to save it. */
export function signInToSave(name: string, replay: Replay): void {
  try { localStorage.setItem(PENDING, JSON.stringify({ name, replay, at: Date.now() })); } catch { /* private mode: nothing to resume */ }
  const back = new URL(location.href);
  back.search = "?save=pending";
  location.href = `${API}/auth/signin?return=${encodeURIComponent(back.toString())}`;
}

export interface Pending { name: string; replay: Replay; at?: number }
const MAX_AGE = 24 * 3600 * 1000;

/** A run waiting to be saved (from a sign-in round trip, even one that lost its way back), if it is
 *  less than a day old. It stays stored until it is saved or rejected (see clearPending). */
export function readPending(): Pending | null {
  if (new URLSearchParams(location.search).get("save") === "pending") history.replaceState(null, "", location.pathname);
  try {
    const raw = localStorage.getItem(PENDING);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    if (p.at && Date.now() - p.at > MAX_AGE) { localStorage.removeItem(PENDING); return null; }
    return p;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try { localStorage.removeItem(PENDING); } catch { /* nothing stored */ }
}

export async function fetchBoard(level: number): Promise<Board | null> {
  try {
    const r = await fetch(`${API}/api/surfer/leaderboard?level=${level}`, { credentials: "include" });
    return r.ok ? ((await r.json()) as Board) : null;
  } catch {
    return null;
  }
}
