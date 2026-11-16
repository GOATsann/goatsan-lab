// A search bot that plays by looking ahead with copies of the game. It is not the AI; it proves the
// track generator only makes runs that can be survived, and it gives a "perfect play" reference.
import { Game, NOOP, type Action } from "./game";

const ACTIONS: Action[] = [0, 1, 2, 3, 4];

/** Survive `decisions` more decisions doing nothing after `first`, with no stumble? */
function survives(g: Game, first: Action, decisions: number): boolean {
  const c = g.clone();
  if (c.decide(first).stumbles) return false;
  for (let i = 0; i < decisions && !c.dead; i++) if (c.decide(NOOP).stumbles) return false;
  return !c.dead;
}

/** Depth-limited search: an action now such that some follow-up keeps the runner alive. */
function safe(g: Game, depth: number, horizon: number): Action | -1 {
  for (const a of ACTIONS) {
    if (survives(g, a, horizon)) return a;
  }
  if (depth === 0) return -1;
  for (const a of ACTIONS) {
    const c = g.clone();
    if (c.decide(a).stumbles || c.dead) continue;
    for (let wait = 0; wait < 6 && !c.dead; wait++) {
      if (safe(c, depth - 1, horizon) !== -1) return a;
      if (c.decide(NOOP).stumbles) break;
    }
  }
  return -1;
}

export function botAction(g: Game, horizon = 12): Action {
  const a = safe(g, 2, horizon);
  return a === -1 ? NOOP : a;
}

/** Play until `meters` or death. Returns the game. */
export function botRun(seed: number, meters: number): Game {
  const g = new Game(seed);
  while (!g.dead && g.meters < meters) g.decide(botAction(g));
  return g;
}
