// The opponent in "Race the AI". A driver picks an action once per decision (every 4 ticks), from
// the same observation the AI was trained on. The trained policy (ONNX) drops in later; until then
// a stand-in plays: the search bot with a short lookahead, so it can be beaten.
import { botAction } from "../core/bot";
import type { Action, Game } from "../core/game";

export interface AiDriver {
  readonly label: string;
  /** a new run: the level's handicap, seeded by the run's seed (call before the first act) */
  start(level: 0 | 1 | 2, seed: number): void;
  act(g: Game): Promise<Action> | Action;
}

/** Stand-in opponent: looks ~0.8 s ahead, so it makes mistakes at speed. */
export class BotDriver implements AiDriver {
  readonly label = "stand-in bot";
  start(): void {}
  act(g: Game): Action {
    return botAction(g, 12);
  }
}

/** The AI opponent: the final trained model (/models/policy-hard.onnx) for every level; each level
 *  weakens it with human-like handicaps (src/core/handicap.ts), set per run by driver.start().
 *  Without the model, the stand-in bot. */
export async function loadAi(): Promise<AiDriver> {
  const { OnnxDriver } = await import("./onnx-driver");
  for (const name of ["policy-hard", "policy"]) {
    try {
      const r = await fetch(`/models/${name}.json`, { cache: "no-store" });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) continue;
      return await OnnxDriver.load(`/models/${name}.onnx`, await r.json());
    } catch (e) {
      console.warn(`AI model ${name} not available`, e);
    }
  }
  return new BotDriver();
}
