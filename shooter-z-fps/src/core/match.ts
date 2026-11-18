// A match = the Game + who controls each robot. Bots run here (deterministic, from the match seed), so a
// replay only needs the seed, the options and the inputs of the non-bot slots (the human, or later an
// external policy). Rebuilding a match from its replay gives the exact same game, tick for tick.

import * as C from "./config";
import { type Action, noop, pack, samePacked, unpack, type PackedAction } from "./actions";
import { HeuristicBot, SKILLS, type SkillName } from "./bot";
import { Game, MODES, VERSION, defaultOptions, type GameOptions, type Mode } from "./game";
import type { MapId } from "./maps";
import { NavGrid } from "./nav";
import { Observation, observe } from "./obs";
import { N_CHARACTERS } from "./characters";
import { Rng } from "./rng";

export type SlotKind = "human" | "bot" | "external";
export interface Slot {
  kind: SlotKind; skill?: SkillName; name: string; /** index into CHARACTERS */ character: number;
  /** training only: a bot that moves and aims but never fires, reloads or uses its ability (a moving target) */
  noFire?: boolean;
}

export interface MatchOptions {
  map: MapId;
  mode: Mode;
  scoreLimit: number;
  slots: Slot[];
  regen?: boolean;
  maxTicks?: number;
}

export interface Replay {
  version: number;
  seed: number;
  options: MatchOptions;
  endTick: number;
  /** sparse inputs of non-bot slots: [slot, tick, ...packed action]; an action holds until the next entry */
  inputs: [number, number, ...PackedAction][];
  hash: number;
}

export const BOT_NAMES = ["Rivet", "Sprocket", "Volt", "Gizmo", "Ratchet"];

/**
 * Standard slot lists: you (slot 0) vs bots; in 2v2 slot 1 is your AI teammate. `spectate` = bots only.
 * Bots get random characters from `seed` (deterministic); the player's pick is `character`.
 */
export function standardSlots(mode: Mode, skill: SkillName, opts: { spectate?: boolean; playerName?: string; character?: number; seed?: number } = {}): Slot[] {
  const n = MODES[mode].teams.length;
  const rng = new Rng(((opts.seed ?? 1) ^ 0xc4a7) >>> 0);
  return Array.from({ length: n }, (_, i) => {
    const random = rng.int(N_CHARACTERS);
    if (i === 0 && !opts.spectate) return { kind: "human" as const, name: opts.playerName ?? "You", character: opts.character ?? 0 };
    const c = random;
    return { kind: "bot" as const, skill, name: `${BOT_NAMES[i % BOT_NAMES.length]}`, character: c };
  });
}

export class Match {
  readonly seed: number;
  readonly options: MatchOptions;
  readonly game: Game;
  readonly nav: NavGrid;
  readonly bots: (HeuristicBot | null)[];
  readonly obs: Observation[];
  private held: Action[];
  private actions: Action[];
  private lastPacked: (PackedAction | null)[];
  private inputs: Replay["inputs"] = [];
  /** tutorial only: a paused bot does nothing (not recorded in replays) */
  readonly paused: boolean[];

  constructor(seed: number, options: MatchOptions) {
    this.seed = seed >>> 0;
    this.options = options;
    const turnCaps = options.slots.map((s) => (s.kind === "bot" ? SKILLS[s.skill ?? "normal"].turnPerTick : C.HUMAN_TURN_CAP));
    const gopts: GameOptions = defaultOptions({ map: options.map, mode: options.mode, scoreLimit: options.scoreLimit, regen: options.regen ?? true, turnCaps, maxTicks: options.maxTicks ?? 0, characters: options.slots.map((s) => s.character ?? 0) });
    if (options.slots.length !== MODES[options.mode].teams.length) throw new Error(`mode ${options.mode} needs ${MODES[options.mode].teams.length} slots`);
    this.game = new Game(this.seed, gopts);
    this.nav = new NavGrid(this.game.map);
    this.bots = options.slots.map((s, i) => (s.kind === "bot" ? new HeuristicBot(i, s.skill ?? "normal", this.seed, this.game.world, this.nav) : null));
    this.obs = options.slots.map(() => new Observation());
    this.held = options.slots.map(() => noop());
    this.actions = options.slots.map(() => noop());
    this.lastPacked = options.slots.map(() => null);
    this.paused = options.slots.map(() => false);
  }

  get tick(): number { return this.game.tick; }
  get over(): boolean { return this.game.over; }

  /** One tick. `ext[i]` is the action for non-bot slot i (missing = do nothing). */
  step(ext: readonly (Action | null | undefined)[] = []): void {
    const g = this.game;
    if (g.over) return;
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (bot && this.paused[i]) {
        this.actions[i] = NOOP;
      } else if (bot) {
        // bots decide every DECISION_TICKS ticks, staggered so they don't all think on the same tick
        if ((g.tick + i) % C.DECISION_TICKS === 0) {
          observe(g, i, this.obs[i]);
          bot.decide(this.obs[i], this.held[i]);
          if (this.options.slots[i].noFire) { this.held[i].fire = false; this.held[i].reload = false; this.held[i].ability = false; }
        }
        this.actions[i] = this.held[i];
      } else {
        const a = ext[i] ?? NOOP;
        const p = pack(a);
        const last = this.lastPacked[i];
        if (!last || !samePacked(last, p)) {
          this.inputs.push([i, g.tick, ...p]);
          this.lastPacked[i] = p;
        }
        unpack(p, this.actions[i]); // the quantized action, exactly as a replay will apply it
      }
    }
    g.step(this.actions);
  }

  replay(): Replay {
    return { version: VERSION, seed: this.seed, options: this.options, endTick: this.game.tick, inputs: this.inputs.map((x) => [...x] as Replay["inputs"][number]), hash: this.game.hash() };
  }

  /** Rebuild a match from its replay (runs it to the end tick). */
  static fromReplay(r: Replay): Match {
    if (r.version !== VERSION) throw new Error(`replay is rules version ${r.version}, this game is ${VERSION}`);
    const m = new Match(r.seed, r.options);
    const cur: (Action | null)[] = r.options.slots.map(() => null);
    let k = 0;
    while (m.tick < r.endTick && !m.over) {
      while (k < r.inputs.length && r.inputs[k][1] === m.tick) {
        const [slot, , ...p] = r.inputs[k++];
        cur[slot] = unpack(p as PackedAction);
      }
      m.step(cur);
    }
    return m;
  }
}

const NOOP: Action = noop();
