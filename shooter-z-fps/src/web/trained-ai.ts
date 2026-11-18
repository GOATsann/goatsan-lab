// The trained AI (PPO + LSTM) in the browser, via onnxruntime-web (WASM, loaded lazily). It plays robots
// that are "external" slots, exactly like the batch server drives a learner (src/headless/server.ts):
//   - every DECISION_TICKS ticks, at the tick before stepping: observe -> encodeObs -> one batched run for
//     all AI robots -> argmax per action part -> the json "decode" table -> fromVector(v, 0, turn cap)
//   - the action holds for the decision's ticks; jump, ability and reload act on the first tick only
//   - LSTM memory h = c = 0 at match start only, fed back every decision (also across respawns)
// The model files live in public/models/ (gitignored; see ASSETS.md).
import { type Action, ACTION_SIZE, fromVector, noop } from "../core/actions";
import { DECISION_TICKS } from "../core/config";
import type { Game } from "../core/game";
import type { Match } from "../core/match";
import { encodeObs, OBS_SIZE, Observation, observe } from "../core/obs";

export interface ModelInfo {
  model: string; steps: number; obs_size: number; lstm_hidden: number;
  action_fields: string[]; action_nvec: number[]; decode: Record<string, number[]>;
  decision_ticks: number; turn_cap_rad_per_tick: number;
}

type Ort = typeof import("onnxruntime-web/wasm");
type Session = import("onnxruntime-web/wasm").InferenceSession;

const MODEL_URL = "models/shooter-ai.onnx";
const INFO_URL = "models/shooter-ai.json";

let loading: Promise<TrainedModel | null> | null = null;

/** Is the model there? (cheap: the json only) */
export async function modelAvailable(): Promise<ModelInfo | null> {
  try {
    const r = await fetch(INFO_URL);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    const info = (await r.json()) as ModelInfo;
    return info.obs_size === OBS_SIZE ? info : null;
  } catch { return null; }
}

/** Forget a failed load so the next loadTrainedModel() tries again (the menu's Retry). */
export function retryModelLoad(): void { loading = null; }

/** Load the model once. Null if it can't be loaded. */
export function loadTrainedModel(): Promise<TrainedModel | null> {
  if (!loading) loading = (async () => {
    const info = await modelAvailable();
    if (!info) return null;
    try {
      const ort: Ort = await import("onnxruntime-web/wasm");
      ort.env.logLevel = "error";
      ort.env.wasm.numThreads = 1;
      // run inference in onnxruntime's own Web Worker so the game keeps its 60 fps
      ort.env.wasm.proxy = true;
      const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
      return new TrainedModel(ort, session, info);
    } catch (e) {
      console.warn("Shooter Z: the AI model could not be loaded", e);
      return null;
    }
  })();
  return loading;
}

export class TrainedModel {
  constructor(readonly ort: Ort, readonly session: Session, readonly info: ModelInfo) {}
  get label(): string { return `${this.info.model.split("/").pop()} · ${Math.round(this.info.steps / 1e6)}M steps`; }
}

/** Drives the AI robots of one match. */
export class TrainedAiController {
  readonly slots: number[];
  private model: TrainedModel;
  private match: Match;
  private obs = new Observation();
  private batch: Float32Array;
  private h: Float32Array; private c: Float32Array;
  private acts: Action[];
  private vec = new Float32Array(ACTION_SIZE);
  private pending: Promise<void> | null = null;
  private decidedTick = -1;
  private turnCap: number;
  private failed = 0;
  /** inference time per decision (ms), for the debug counter and the report */
  readonly times: number[] = [];

  constructor(model: TrainedModel, match: Match, slots: number[]) {
    this.model = model;
    this.match = match;
    this.slots = slots;
    const B = slots.length, H = model.info.lstm_hidden;
    this.batch = new Float32Array(B * OBS_SIZE);
    this.h = new Float32Array(B * H);
    this.c = new Float32Array(B * H);
    this.acts = slots.map(() => noop());
    this.turnCap = model.info.turn_cap_rad_per_tick;
    // the learner's turn cap, as in training
    for (const s of slots) match.game.options.turnCaps[s] = this.turnCap;
  }

  /**
   * Call before every tick. True when the AI robots' actions for this tick are ready (they are then in
   * ext[slot]); false while a decision is being computed (the game waits a moment, like training does).
   */
  ready(ext: (Action | null | undefined)[]): boolean {
    const g = this.match.game;
    const decisionTick = g.tick % this.model.info.decision_ticks === 0;
    if (decisionTick && this.decidedTick !== g.tick) {
      if (!this.pending) this.pending = this.decide(g)
        .catch((e) => { if (!this.failed++) console.warn("Shooter Z: AI decision failed, keeping its last action", e); })
        .then(() => { this.decidedTick = g.tick; this.pending = null; });
      return false;
    }
    for (let i = 0; i < this.slots.length; i++) {
      ext[this.slots[i]] = this.acts[i];
    }
    return true;
  }

  /** After the tick: the one-shot buttons only act on a decision's first tick. */
  afterTick(): void {
    for (const a of this.acts) { a.jump = false; a.ability = false; a.reload = false; }
  }

  private async decide(g: Game): Promise<void> {
    const { ort, session, info } = this.model;
    const B = this.slots.length, H = info.lstm_hidden;
    for (let i = 0; i < B; i++) {
      observe(g, this.slots[i], this.obs);
      encodeObs(this.obs, this.batch, i * OBS_SIZE);
    }
    const t0 = performance.now();
    // fresh copies: the worker proxy transfers (detaches) the buffers it is given
    const out = await session.run({
      obs: new ort.Tensor("float32", this.batch.slice(), [B, OBS_SIZE]),
      h: new ort.Tensor("float32", this.h.slice(), [1, B, H]),
      c: new ort.Tensor("float32", this.c.slice(), [1, B, H]),
    });
    this.times.push(performance.now() - t0);
    if (this.times.length > 600) this.times.shift();
    const logits = out.logits.data as Float32Array;
    this.h = new Float32Array(out.h_out.data as Float32Array);
    this.c = new Float32Array(out.c_out.data as Float32Array);
    const nvec = info.action_nvec, fields = info.action_fields, total = nvec.reduce((s, x) => s + x, 0);
    for (let i = 0; i < B; i++) {
      let o = i * total;
      for (let k = 0; k < nvec.length; k++) {
        let best = 0;
        for (let j = 1; j < nvec[k]; j++) if (logits[o + j] > logits[o + best]) best = j;
        this.vec[k] = info.decode[fields[k]][best];
        o += nvec[k];
      }
      fromVector(this.vec, 0, this.turnCap, this.acts[i]);
    }
  }

  avgMs(): number { return this.times.length ? this.times.reduce((s, x) => s + x, 0) / this.times.length : 0; }
}

export { DECISION_TICKS };
