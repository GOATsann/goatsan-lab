// Batch server for RL training (protocol in PROTOCOL.md, same shape as runner/PROTOCOL.md).
// Each env is one match. Robot 0 is always a learner (an "external" slot, driven by Python); robot 1 is
// set by the handshake's `opponent`: a heuristic bot, a still or moving training target, or a second
// learner (self-play: Python drives both). Every per-match array is per learner ("agent" = env x
// learner), so with one learner per match the wire format is protocol 1's. Many envs per process,
// stepped in lockstep; auto-reset with the terminal observation.
//   npm run server -- --port 7001
import { createServer, type Server, type Socket } from "node:net";
import { pathToFileURL } from "node:url";
import { ACTION_FIELDS, ACTION_SIZE, fromVector, noop, type Action } from "../core/actions";
import { SKILL_NAMES, SKILLS, type SkillName } from "../core/bot";
import { CHARACTERS, N_CHARACTERS } from "../core/characters";
import * as C from "../core/config";
import { MODES, STAT_FIELDS, VERSION, type Mode } from "../core/game";
import { MAP_IDS, type MapId } from "../core/maps";
import { BOT_NAMES, Match, type Replay, type Slot } from "../core/match";
import { encodeObs, OBS_LAYOUT, OBS_SIZE, Observation, observe } from "../core/obs";
import { Rng } from "../core/rng";

export const PROTOCOL_VERSION = 2;
/** what robot 1 (and, beyond duel, every non-learner robot) is */
export type Opponent = "bot" | "still" | "moving" | "learner";
export const EVENT_FIELDS = [...STAT_FIELDS, "won", "lost", "teamScore", "enemyScore", "ticks"] as const;
export const END_CAUSES = ["", "won", "lost"] as const;

export interface Handshake {
  n_envs: number;
  seed_base: number;
  max_ticks: number;
  mode?: Mode;
  map?: MapId | "random";
  opponent_skill?: SkillName | "random";
  /** the learner's character: index, or "random" */
  character?: number | "random";
  score_limit?: number;
  /** learner's max turn per tick, radians (default: like a fast human, 10 rad/s) */
  turn_cap?: number;
  /** "bot" (default), "still" (a target that never moves or fires), "moving" (a bot that never fires),
   *  "learner" (duel only: robot 1 is a second learner, for self-play) */
  opponent?: Opponent;
}

interface Env {
  match: Match;
  seed: number;
  episode: number; // how many episodes this env has started
  fixed: boolean; // running a command-4 seed
  lastReplay: Replay | null;
}

export class Batch {
  readonly h: Required<Handshake>;
  readonly envs: Env[] = [];
  /** robot slots Python drives in every match, in reply order */
  readonly learners: number[];
  private obs = new Observation();
  private acts: Action[];

  constructor(h: Handshake) {
    this.h = {
      mode: "duel", map: "random", opponent_skill: "random", character: "random", score_limit: C.DEFAULT_SCORE_LIMIT,
      turn_cap: 10 / C.TICK_HZ, opponent: "bot", ...h,
    };
    if (!["bot", "still", "moving", "learner"].includes(this.h.opponent)) throw new Error(`unknown opponent ${this.h.opponent}`);
    if (this.h.opponent === "learner" && this.h.mode !== "duel") throw new Error("self-play (opponent: learner) is duel only for now");
    this.learners = this.h.opponent === "learner" ? [0, 1] : [0];
    this.acts = this.learners.map(() => noop());
    for (let i = 0; i < h.n_envs; i++) this.envs.push({ match: this.newMatch(this.seedFor(i, 0)), seed: this.seedFor(i, 0), episode: 0, fixed: false, lastReplay: null });
  }

  hello(): object {
    return {
      version: VERSION,
      protocol: PROTOCOL_VERSION,
      obs_size: OBS_SIZE,
      action_size: ACTION_SIZE,
      action_fields: ACTION_FIELDS,
      action_layout: {
        forward: "{-1,0,1} (rounded at +-0.5)", strafe: "{-1,0,1}", jump: ">0.5", crouch: ">0.5 (held)", yaw: "[-1,1] x turn_cap per tick (+ = left)",
        pitch: "[-1,1] x turn_cap per tick (+ = up)", fire: ">0.5 (held)", reload: ">0.5", ability: ">0.5",
      },
      turn_cap: this.h.turn_cap,
      decision_ticks: C.DECISION_TICKS,
      tick_hz: C.TICK_HZ,
      event_fields: EVENT_FIELDS,
      end_causes: END_CAUSES,
      mode: this.h.mode,
      agents: MODES[this.h.mode].teams.length,
      learner_slot: 0,
      learner_slots: this.learners,
      opponent: this.h.opponent,
      characters: CHARACTERS.map((c) => ({ id: c.id, name: c.name, ability: c.ability })),
      skills: SKILL_NAMES,
      obs_layout: OBS_LAYOUT,
    };
  }

  private seedFor(env: number, k: number): number {
    return (this.h.seed_base + k * this.h.n_envs + env) >>> 0;
  }

  /** Everything about an episode comes from its seed (map, opponent level, characters). */
  newMatch(seed: number): Match {
    const r = new Rng((seed ^ 0x51ed) >>> 0);
    const mode = this.h.mode;
    const n = MODES[mode].teams.length;
    const map: MapId = this.h.map === "random" ? MAP_IDS[r.int(MAP_IDS.length)] : this.h.map;
    const skill: SkillName = this.h.opponent_skill === "random" ? SKILL_NAMES[r.int(SKILL_NAMES.length)] : this.h.opponent_skill;
    const myChar = this.h.character === "random" ? r.int(N_CHARACTERS) : this.h.character;
    const opp = this.h.opponent;
    const slots: Slot[] = Array.from({ length: n }, (_, i): Slot => {
      if (i === 0) return { kind: "external", name: "Learner", character: myChar };
      const character = r.int(N_CHARACTERS);
      if (opp === "learner") return { kind: "external", name: "Learner 2", character };
      if (opp === "still") return { kind: "external", name: "Target", character }; // Python never drives it: it stands still
      return { kind: "bot", skill, name: BOT_NAMES[i], character, ...(opp === "moving" ? { noFire: true } : {}) };
    });
    const m = new Match(seed, { map, mode, scoreLimit: this.h.score_limit, slots, maxTicks: this.h.max_ticks });
    for (const s of this.learners) m.game.options.turnCaps[s] = this.h.turn_cap; // the learners' turn cap
    return m;
  }

  /** every learner's observation of env `env`, from `off` on (learner order) */
  private writeObs(env: number, out: Float32Array, off: number): void {
    const m = this.envs[env].match;
    for (let j = 0; j < this.learners.length; j++) {
      observe(m.game, this.learners[j], this.obs);
      encodeObs(this.obs, out, off + j * OBS_SIZE);
    }
  }

  resetAll(): Float32Array {
    const L = this.learners.length;
    const out = new Float32Array(this.envs.length * L * OBS_SIZE);
    for (let i = 0; i < this.envs.length; i++) {
      const e = this.envs[i];
      e.episode++;
      e.seed = this.seedFor(i, e.episode);
      e.fixed = false;
      e.match = this.newMatch(e.seed);
      this.writeObs(i, out, i * L * OBS_SIZE);
    }
    return out;
  }

  fixedSeed(env: number, seed: number): Float32Array {
    const e = this.envs[env];
    e.seed = seed >>> 0;
    e.fixed = true;
    e.match = this.newMatch(e.seed);
    const out = new Float32Array(this.learners.length * OBS_SIZE);
    this.writeObs(env, out, 0);
    return out;
  }

  /** One decision for every env. Arrays are per agent (env x learner, learner order); `done` lists agents. */
  step(actions: Float32Array): { obs: Float32Array; events: Float32Array; terminated: Uint8Array; truncated: Uint8Array; cause: Uint8Array; seeds: Uint32Array; done: { env: number; obs: Float32Array }[] } {
    const L = this.learners.length, n = this.envs.length * L, nf = EVENT_FIELDS.length;
    const obs = new Float32Array(n * OBS_SIZE), events = new Float32Array(n * nf);
    const terminated = new Uint8Array(n), truncated = new Uint8Array(n), cause = new Uint8Array(n), seeds = new Uint32Array(n);
    const done: { env: number; obs: Float32Array }[] = [];
    const ext: (Action | null)[] = [];
    for (let i = 0; i < this.envs.length; i++) {
      const e = this.envs[i];
      const m = e.match, g = m.game;
      ext.length = 0;
      for (let j = 0; j < L; j++) {
        const a = i * L + j;
        seeds[a] = e.seed;
        fromVector(actions, a * ACTION_SIZE, this.h.turn_cap, this.acts[j]);
        ext[this.learners[j]] = this.acts[j];
      }
      for (let t = 0; t < C.DECISION_TICKS && !g.over; t++) {
        m.step(ext);
        for (let j = 0; j < L; j++) {
          const st = g.stats[this.learners[j]], base = (i * L + j) * nf;
          for (let f = 0; f < STAT_FIELDS.length; f++) events[base + f] += st[STAT_FIELDS[f]];
          // one-shot buttons only on the first tick of a decision
          this.acts[j].jump = false; this.acts[j].ability = false; this.acts[j].reload = false;
        }
      }
      for (let j = 0; j < L; j++) {
        const a = i * L + j;
        const me = g.agents[this.learners[j]];
        const won = g.over && !g.truncated && g.winnerTeam === me.team;
        const lost = g.over && !g.truncated && g.winnerTeam !== me.team;
        let enemy = 0;
        for (let t = 0; t < g.teamScore.length; t++) if (t !== me.team) enemy = Math.max(enemy, g.teamScore[t]);
        const base = a * nf + STAT_FIELDS.length;
        events[base] = won ? 1 : 0; events[base + 1] = lost ? 1 : 0;
        events[base + 2] = g.teamScore[me.team]; events[base + 3] = enemy; events[base + 4] = g.tick;
        if (g.over) {
          terminated[a] = g.truncated ? 0 : 1;
          truncated[a] = g.truncated ? 1 : 0;
          cause[a] = won ? 1 : lost ? 2 : 0;
        }
      }
      if (g.over) {
        const term = new Float32Array(L * OBS_SIZE);
        this.writeObs(i, term, 0);
        for (let j = 0; j < L; j++) done.push({ env: i * L + j, obs: term.subarray(j * OBS_SIZE, (j + 1) * OBS_SIZE) });
        e.lastReplay = m.replay();
        e.episode++;
        e.fixed = false;
        e.seed = this.seedFor(i, e.episode);
        e.match = this.newMatch(e.seed);
      }
      this.writeObs(i, obs, i * L * OBS_SIZE);
    }
    return { obs, events, terminated, truncated, cause, seeds, done };
  }
}

// ------------------------------------------------------------------------------------------ TCP
function frame(body: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h.writeUInt32LE(body.length, 0);
  return Buffer.concat([h, body]);
}
const f32 = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

export function handleConnection(sock: Socket, onClose: () => void = () => {}): void {
  let buf = Buffer.alloc(0);
  let batch: Batch | null = null;
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      if (!batch) {
        batch = new Batch(JSON.parse(body.toString("utf8")) as Handshake);
        sock.write(frame(Buffer.from(JSON.stringify(batch.hello()), "utf8")));
        continue;
      }
      const cmd = body.readUInt8(0);
      if (cmd === 0) { sock.end(); onClose(); return; }
      if (cmd === 1) sock.write(frame(f32(batch.resetAll())));
      else if (cmd === 2) {
        const n = batch.envs.length * batch.learners.length; // one action per agent
        const acts = new Float32Array(n * ACTION_SIZE);
        Buffer.from(body.subarray(1, 1 + acts.byteLength)).copy(Buffer.from(acts.buffer));
        const r = batch.step(acts);
        const parts: Buffer[] = [f32(r.obs), f32(r.events), Buffer.from(r.terminated), Buffer.from(r.truncated), Buffer.from(r.cause), Buffer.from(r.seeds.buffer)];
        const nd = Buffer.alloc(2); nd.writeUInt16LE(r.done.length, 0);
        parts.push(nd);
        for (const d of r.done) { const e = Buffer.alloc(2); e.writeUInt16LE(d.env, 0); parts.push(e, f32(d.obs)); }
        sock.write(frame(Buffer.concat(parts)));
      } else if (cmd === 3) {
        const env = body.readUInt16LE(1);
        sock.write(frame(Buffer.from(JSON.stringify(batch.envs[env].lastReplay), "utf8")));
      } else if (cmd === 4) {
        const env = body.readUInt16LE(1), seed = body.readUInt32LE(3);
        sock.write(frame(f32(batch.fixedSeed(env, seed))));
      }
    }
  });
  sock.on("error", () => onClose());
}

export function listen(port: number): Server {
  const srv = createServer((s) => handleConnection(s));
  srv.listen(port, "127.0.0.1");
  return srv;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--port");
  const port = i >= 0 ? Number(process.argv[i + 1]) : 7001;
  listen(port);
  console.log(`Shooter Z batch server on 127.0.0.1:${port} (obs ${OBS_SIZE} floats, action ${ACTION_SIZE} floats, opponents: ${Object.keys(SKILLS).join("/")} bots, still/moving targets, or a second learner)`);
}
