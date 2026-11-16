// The trained policy in the browser, via onnxruntime-web (WASM). Same observation as training
// (src/core/obs.ts), argmax over the action logits = deterministic play, like the benchmark.
import type { Action, Game } from "../core/game";
import { HandicapFilter } from "../core/handicap";
import { OBS_SIZE, observe } from "../core/obs";
import type { AiDriver } from "./ai";

export interface PolicyInfo { version: number; obs_size: number; n_actions: number; run?: string; steps?: number }

export class OnnxDriver implements AiDriver {
  private buf = new Float32Array(OBS_SIZE);
  private filter: HandicapFilter | null = null;
  private constructor(readonly label: string, private session: import("onnxruntime-web/wasm").InferenceSession, private ort: typeof import("onnxruntime-web/wasm")) {}

  static async load(url: string, info: PolicyInfo): Promise<OnnxDriver> {
    if (info.obs_size !== OBS_SIZE) throw new Error(`policy expects obs ${info.obs_size}, game gives ${OBS_SIZE}`);
    const ort = await import("onnxruntime-web/wasm");
    ort.env.logLevel = "error"; // no "Unknown CPU vendor" style warnings in visitors' consoles
    const session = await ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
    return new OnnxDriver(info.run ? `${info.run}${info.steps ? ` · ${Math.round(info.steps / 1e6)}M steps` : ""}` : "trained AI", session, ort);
  }

  start(level: 0 | 1 | 2, seed: number): void {
    this.filter = new HandicapFilter(level, seed);
  }

  /** see -> model -> argmax -> decide, on the decision tick (the same path as bench-opponent.ts). */
  async act(g: Game): Promise<Action> {
    observe(g, this.buf);
    const seen = this.filter ? this.filter.see(this.buf) : this.buf;
    const out = await this.session.run({ obs: new this.ort.Tensor("float32", seen, [1, OBS_SIZE]) });
    const logits = out.logits.data as Float32Array;
    let best = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
    return this.filter ? this.filter.decide(best as Action, this.buf) : (best as Action);
  }
}
