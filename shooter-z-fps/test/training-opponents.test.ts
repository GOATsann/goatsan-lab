// The training opponents (still / moving targets) and self-play (two learners per match).
import { describe, expect, it } from "vitest";
import { ACTION_SIZE, noop } from "../src/core/actions";
import { HeuristicBot } from "../src/core/bot";
import { OBS_SIZE, Observation, observe } from "../src/core/obs";
import { Batch, EVENT_FIELDS } from "../src/headless/server";

const F = (name: string) => EVENT_FIELDS.indexOf(name as (typeof EVENT_FIELDS)[number]);

describe("training opponents", () => {
  it("a still target never moves or fires", () => {
    const b = new Batch({ n_envs: 2, seed_base: 11, max_ticks: 3600, opponent: "still", map: "base" });
    b.resetAll();
    const start = b.envs.map((e) => ({ x: e.match.game.agents[1].x, z: e.match.game.agents[1].z }));
    for (let k = 0; k < 300; k++) b.step(new Float32Array(2 * ACTION_SIZE));
    b.envs.forEach((e, i) => {
      const a = e.match.game.agents[1];
      expect(Math.hypot(a.x - start[i].x, a.z - start[i].z)).toBeLessThan(0.01);
      expect(e.match.game.agents[0].health).toBe(100); // it never shot the learner
    });
  });

  it("a moving target moves but never fires", () => {
    const b = new Batch({ n_envs: 4, seed_base: 21, max_ticks: 36000, opponent: "moving", opponent_skill: "hard" });
    b.resetAll();
    let moved = 0, damageTaken = 0;
    const last = b.envs.map((e) => ({ x: e.match.game.agents[1].x, z: e.match.game.agents[1].z }));
    for (let k = 0; k < 1200; k++) {
      const r = b.step(new Float32Array(4 * ACTION_SIZE));
      for (let i = 0; i < 4; i++) damageTaken += r.events[i * EVENT_FIELDS.length + F("damageTaken")];
      b.envs.forEach((e, i) => {
        const a = e.match.game.agents[1];
        moved += Math.hypot(a.x - last[i].x, a.z - last[i].z);
        last[i] = { x: a.x, z: a.z };
      });
    }
    expect(moved).toBeGreaterThan(20);
    expect(damageTaken).toBe(0);
  });
});

describe("self-play (two learners)", () => {
  // Both learners are driven through the protocol by the game's own Hard bot logic, so real fights happen.
  function botVector(bot: HeuristicBot, g: Batch["envs"][number]["match"]["game"], slot: number, o: Observation, out: Float32Array, off: number, cap: number) {
    observe(g, slot, o);
    const a = noop();
    bot.decide(o, a);
    out.set([a.forward, a.strafe, +a.jump, +a.crouch, a.yaw / cap, a.pitch / cap, +a.fire, +a.reload, +a.ability], off);
  }

  it("each learner gets its own obs and events; a finished match is one win and one loss", () => {
    const n = 4, L = 2;
    const b = new Batch({ n_envs: n, seed_base: 31, max_ticks: 60 * 60 * 10, opponent: "learner", score_limit: 1 });
    expect(b.learners).toEqual([0, 1]);
    expect((b.hello() as { learner_slots: number[] }).learner_slots).toEqual([0, 1]);
    expect(b.resetAll().length).toBe(n * L * OBS_SIZE);
    const cap = b.h.turn_cap, o = new Observation();
    const bots = new Map<string, HeuristicBot>();
    const botFor = (i: number, s: number) => {
      const m = b.envs[i].match, key = `${b.envs[i].seed}:${s}`;
      if (!bots.has(key)) bots.set(key, new HeuristicBot(s, "hard", m.seed, m.game.world, m.nav));
      return bots.get(key)!;
    };
    let ends = 0, kills = 0, deaths = 0;
    for (let k = 0; k < 20000 && ends < 6; k++) {
      const acts = new Float32Array(n * L * ACTION_SIZE);
      for (let i = 0; i < n; i++) for (let j = 0; j < L; j++) botVector(botFor(i, j), b.envs[i].match.game, j, o, acts, (i * L + j) * ACTION_SIZE, cap);
      const r = b.step(acts);
      expect(r.obs.length).toBe(n * L * OBS_SIZE);
      expect(r.done.length % L).toBe(0); // both learners of a finished match, together
      for (let a = 0; a < n * L; a++) {
        kills += r.events[a * EVENT_FIELDS.length + F("kills")];
        deaths += r.events[a * EVENT_FIELDS.length + F("deaths")];
      }
      for (let i = 0; i < n; i++) {
        if (!r.terminated[i * L]) continue;
        ends++;
        expect(r.terminated[i * L + 1]).toBe(1);
        expect([r.cause[i * L], r.cause[i * L + 1]].sort()).toEqual([1, 2]); // one won, one lost
        expect(r.events[(i * L) * EVENT_FIELDS.length + F("won")] + r.events[(i * L + 1) * EVENT_FIELDS.length + F("won")]).toBe(1);
      }
    }
    expect(ends).toBeGreaterThanOrEqual(6);
    expect(kills).toBe(deaths); // every elimination is one learner's kill and the other's death
  });

  it("a training cut-off ends both learners' episodes with no winner", () => {
    const b = new Batch({ n_envs: 2, seed_base: 41, max_ticks: 90, opponent: "learner" });
    b.resetAll();
    let r = b.step(new Float32Array(4 * ACTION_SIZE));
    for (let k = 0; k < 40 && !r.truncated[0]; k++) r = b.step(new Float32Array(4 * ACTION_SIZE));
    expect([...r.truncated]).toEqual([1, 1, 1, 1]);
    expect([...r.terminated]).toEqual([0, 0, 0, 0]);
    expect([...r.cause]).toEqual([0, 0, 0, 0]);
  });
});
