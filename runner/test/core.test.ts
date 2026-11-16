import { describe, expect, it } from "vitest";
import * as C from "../src/core/config";
import { botRun } from "../src/core/bot";
import { Game, JUMP, LEFT, NOOP, POWER_KINDS, ROLL, laneX, type Action, type GameOptions } from "../src/core/game";
import { Rng } from "../src/core/rng";

/** A game with the generated track removed and our own obstacles in it. */
function lab(items: { kind: "low" | "high" | "train" | "ramp"; lane: number; z0: number; len: number }[], opts: Partial<GameOptions> = {}): Game {
  const g = new Game(1, opts);
  g.obstacles = items.map((it, i) => ({ id: 1000 + i, kind: it.kind, lane: it.lane, z0: it.z0, z1: it.z0 + it.len, moving: false, awake: false, broken: false }));
  g.pickups = [];
  (g as unknown as { nextChunkZ: number }).nextChunkZ = 1e12; // no more track
  return g;
}
const runUntil = (g: Game, z: number, act: (g: Game) => Action = () => NOOP) => {
  while (!g.dead && g.z < z) g.step(act(g));
  return g;
};

describe("determinism", () => {
  it("same seed and actions give the same hash every tick", () => {
    const r = new Rng(42);
    const actions = Array.from({ length: 3000 }, () => r.int(5) as Action);
    const a = new Game(7), b = new Game(7);
    for (const act of actions) {
      a.step(act);
      b.step(act);
      expect(a.hash()).toBe(b.hash());
    }
  });
  it("a replay rebuilds the exact game", () => {
    const g = botRun(3, 400);
    const again = Game.fromReplay(JSON.parse(JSON.stringify(g.replay())));
    expect(again.hash()).toBe(g.hash());
    expect(again.score).toBe(g.score);
  });
  it("different seeds give different tracks", () => {
    expect(new Game(1).hash()).not.toBe(new Game(2).hash());
  });
  it("clone is independent", () => {
    const g = new Game(5);
    const c = g.clone();
    c.decide(LEFT);
    expect(g.hash()).not.toBe(c.hash());
    expect(new Game(5).hash()).toBe(g.hash());
  });
});

describe("rules", () => {
  const low = (z0 = 20000) => ({ kind: "low" as const, lane: 1, z0, len: 400 });
  const high = (z0 = 20000) => ({ kind: "high" as const, lane: 1, z0, len: 400 });
  it("running into a barrier is a stumble: you break through, slow down, the chaser closes in", () => {
    const g = runUntil(lab([low()]), 30000);
    expect(g.dead).toBe(false);
    expect(g.stumbleCount).toBe(1);
    expect(g.chaserGap).toBe(C.CHASER_CLOSE); // held close while the chaser timer runs
    expect(g.obstacles[0].broken).toBe(true);
  });
  it("jumping clears a low barrier with no stumble", () => {
    const g = runUntil(lab([low()]), 30000, (g) => (g.z > 16800 && g.z < 17200 && g.grounded ? JUMP : NOOP));
    expect(g.events.stumbles + g.stumbleCount).toBe(0);
  });
  it("a high barrier needs a roll", () => {
    expect(runUntil(lab([high()]), 30000, (g) => (g.z > 19000 && !g.rolling ? ROLL : NOOP)).stumbleCount).toBe(0);
    expect(runUntil(lab([high()]), 30000).stumbleCount).toBe(1);
  });
  it("a second stumble while the chaser is close catches you; running clean resets it", () => {
    expect(runUntil(lab([low(20000), low(40000)]), 50000).deathCause).toBe("caught");
    // far enough apart: the chaser has dropped back before the second barrier
    const far = runUntil(lab([low(20000), low(20000 + 6 * 60 * 260)]), 20000 + 6 * 60 * 260 + 3000);
    expect(far.dead).toBe(false);
    // 3 allowed: survives two quick stumbles, caught on the third
    expect(runUntil(lab([low(20000), low(30000)], { stumblesToCatch: 3 }), 35000).dead).toBe(false);
    expect(runUntil(lab([low(20000), low(30000), low(40000)], { stumblesToCatch: 3 }), 45000).deathCause).toBe("caught");
  });
  it("a train front still ends the run; a ramp takes you onto the roof", () => {
    expect(runUntil(lab([{ kind: "train", lane: 1, z0: 20000, len: C.TRAIN.len }]), 30000).deathCause).toBe("train front");
    const g = runUntil(lab([{ kind: "ramp", lane: 1, z0: 12000, len: C.RAMP_LEN }, { kind: "train", lane: 1, z0: 20000, len: C.TRAIN.len }]), 30000);
    expect(g.dead).toBe(false);
    expect(g.y).toBe(C.TRAIN.height);
  });
  it("a shield takes one hit, even a train", () => {
    const g = lab([{ kind: "train", lane: 1, z0: 20000, len: C.TRAIN.len }]);
    g.shieldTicks = C.SHIELD_TICKS;
    runUntil(g, 30000);
    expect(g.dead).toBe(false);
    expect(g.shieldTicks).toBe(0);
  });
  it("changing lanes into the side of a train is a stumble and bounces you back", () => {
    const g = lab([{ kind: "train", lane: 0, z0: 5000, len: C.TRAIN.len }]);
    runUntil(g, 10000);
    g.step(LEFT);
    runUntil(g, 14000);
    expect(g.dead).toBe(false);
    expect(g.x).toBe(laneX(1));
    expect(g.stumbleCount).toBe(1);
    g.step(LEFT);
    runUntil(g, 18000);
    expect(g.deathCause).toBe("caught");
  });
  it("a roll lasts 0.6 s even if roll is pressed again and again", () => {
    const g = lab([]);
    let low = 0, longest = 0, run = 0;
    for (let i = 0; i < 600; i++) { // press roll every tick for 10 s
      g.step(ROLL);
      run = g.rolling ? run + 1 : 0;
      longest = Math.max(longest, run);
      low += g.rolling ? 1 : 0;
    }
    expect(longest).toBeLessThanOrEqual(C.ROLL_TICKS);
    expect(low / 600).toBeLessThan(0.8); // it must stand up between rolls
    g.step(NOOP);
    for (let i = 0; i < C.ROLL_TICKS; i++) g.step(NOOP);
    expect(g.rolling).toBe(false);
  });
  it("coins are collected and scored", () => {
    const g = new Game(11);
    g.obstacles = [];
    g.pickups = [{ id: 1, kind: "coin", lane: 1, z: 5000, y: C.COIN_HEIGHT, taken: false }];
    runUntil(g, 8000);
    expect(g.coins).toBe(1);
    expect(g.score).toBe(g.meters + C.SCORE_COIN);
  });
  it("power-ups can be switched off without changing the rest of the track", () => {
    const on = new Game(77), off = new Game(77, { powerups: false });
    // build 3 km of track on both, without playing (the track is generated ahead of z)
    for (const g of [on, off]) for (let z = 0; z <= 3_000_000; z += 50_000) {
      g.z = z;
      (g as unknown as { buildTrack: () => void }).buildTrack();
    }
    const key = (g: Game) => g.obstacles.map((o) => `${o.kind}${o.lane}@${o.z0}`).join();
    expect(key(off)).toBe(key(on));
    expect(off.pickups.some((p) => POWER_KINDS.includes(p.kind))).toBe(false);
  });
});

describe("track generator", () => {
  it("every seed can be survived for 1.5 km by the search bot", () => {
    for (let seed = 0; seed < 12; seed++) {
      const g = botRun(seed, 1500);
      expect({ seed, dead: g.dead, cause: g.deathCause, m: g.meters }).toEqual({ seed, dead: false, cause: "", m: g.meters });
    }
  }, 120000);
});
