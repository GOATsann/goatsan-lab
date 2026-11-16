import { describe, expect, it } from "vitest";
import * as C from "../src/core/config";
import { botRun } from "../src/core/bot";
import { Game, JUMP, LEFT, NOOP, ROLL, laneX, type Action } from "../src/core/game";
import { Rng } from "../src/core/rng";

/** A game with the generated track removed and our own obstacles in it. */
function lab(items: { kind: "low" | "high" | "train" | "ramp"; lane: number; z0: number; len: number }[]): Game {
  const g = new Game(1);
  g.obstacles = items.map((it, i) => ({ id: 1000 + i, kind: it.kind, lane: it.lane, z0: it.z0, z1: it.z0 + it.len, moving: false, awake: false }));
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
  it("running into a low barrier kills; jumping clears it", () => {
    expect(runUntil(lab([{ kind: "low", lane: 1, z0: 20000, len: 400 }]), 30000).deathCause).toBe("low front");
    const g = runUntil(lab([{ kind: "low", lane: 1, z0: 20000, len: 400 }]), 30000, (g) => (g.z > 16800 && g.z < 17200 && g.grounded ? JUMP : NOOP));
    expect(g.dead).toBe(false);
  });
  it("a high barrier needs a roll", () => {
    expect(runUntil(lab([{ kind: "high", lane: 1, z0: 20000, len: 400 }]), 30000, (g) => (g.z > 18500 && g.grounded ? JUMP : NOOP)).dead).toBe(true);
    const g = runUntil(lab([{ kind: "high", lane: 1, z0: 20000, len: 400 }]), 30000, (g) => (g.z > 19000 && !g.rolling ? ROLL : NOOP));
    expect(g.dead).toBe(false);
  });
  it("a train front kills; a ramp takes you onto the roof", () => {
    expect(runUntil(lab([{ kind: "train", lane: 1, z0: 20000, len: C.TRAIN.len }]), 30000).deathCause).toBe("train front");
    const g = runUntil(lab([{ kind: "ramp", lane: 1, z0: 12000, len: C.RAMP_LEN }, { kind: "train", lane: 1, z0: 20000, len: C.TRAIN.len }]), 30000);
    expect(g.dead).toBe(false);
    expect(g.y).toBe(C.TRAIN.height);
  });
  it("changing lanes into the side of a train bounces you back once", () => {
    const g = lab([{ kind: "train", lane: 0, z0: 5000, len: C.TRAIN.len }]);
    runUntil(g, 10000);
    g.step(LEFT);
    runUntil(g, 14000);
    expect(g.dead).toBe(false);
    expect(g.x).toBe(laneX(1));
    expect(g.stumbleTicks).toBeGreaterThan(0);
    g.step(LEFT);
    runUntil(g, 18000);
    expect(g.deathCause).toBe("train side, twice");
  });
  it("coins are collected and scored", () => {
    const g = new Game(11);
    g.obstacles = [];
    g.pickups = [{ id: 1, kind: "coin", lane: 1, z: 5000, y: C.COIN_HEIGHT, taken: false }];
    runUntil(g, 8000);
    expect(g.coins).toBe(1);
    expect(g.score).toBe(g.meters + C.SCORE_COIN);
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
