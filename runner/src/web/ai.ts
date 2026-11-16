// The opponent in "Race the AI". A driver picks an action once per decision (every 4 ticks), from
// the same observation the AI was trained on. The trained policy (ONNX) drops in later; until then
// a stand-in plays: the search bot with a short lookahead, so it can be beaten.
import { botAction } from "../core/bot";
import type { Action, Game } from "../core/game";

export interface AiDriver {
  readonly label: string;
  act(g: Game): Promise<Action> | Action;
}

/** Stand-in opponent: looks ~0.8 s ahead, so it makes mistakes at speed. */
export class BotDriver implements AiDriver {
  readonly label = "stand-in bot";
  act(g: Game): Action {
    return botAction(g, 12);
  }
}

/** The trained policy if one is published at /models/policy.onnx, else the stand-in. */
export async function loadAi(): Promise<AiDriver> {
  try {
    const r = await fetch("/models/policy.json", { cache: "no-store" });
    if (r.ok) {
      const { OnnxDriver } = await import("./onnx-driver");
      return await OnnxDriver.load("/models/policy.onnx", await r.json());
    }
  } catch (e) {
    console.warn("trained AI not available, using the stand-in", e);
  }
  return new BotDriver();
}
