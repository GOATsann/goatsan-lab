import { describe, expect, it } from "vitest";
import { type Action, noop } from "../src/core/actions";
import * as C from "../src/core/config";
import { atan, atan2, cos, sin } from "../src/core/fmath";
import { Game, type GameOptions } from "../src/core/game";
import { Match, standardSlots } from "../src/core/match";
import { encodeObs, L_HEAD, L_LEGS, L_MATE, L_SHIELD, L_TORSO, MEM_PING, MEM_SCAN, N_RAYS, OBS_SIZE, Observation, observe } from "../src/core/obs";
import { Rng } from "../src/core/rng";

/** A game with robots placed by hand (spawn protection off). Ship map: the east corridor x = 11 is a clear lane. */
function lab(opts: Partial<GameOptions> = {}): Game {
  const g = new Game(1, { map: "ship", mode: "duel", ...opts });
  for (const a of g.agents) { a.protectTicks = 0; a.vx = a.vy = a.vz = 0; }
  return g;
}
function place(g: Game, id: number, x: number, z: number, yaw = 0, pitch = 0): void {
  const a = g.agents[id];
  a.x = x; a.z = z; a.y = 0; a.yaw = yaw; a.pitch = pitch; a.alive = true; a.grounded = true; a.protectTicks = 0;
}
/** Aim agent `from` at a height on agent `to` (pitch from the eye). */
function aimAt(g: Game, from: number, to: number, y: number): void {
  const a = g.agents[from], b = g.agents[to];
  const dx = b.x - a.x, dz = b.z - a.z;
  a.yaw = atan2(-dx, -dz);
  a.pitch = atan((b.y + y - g.eyeY(a)) / Math.sqrt(dx * dx + dz * dz));
}
const acts = (n: number, set: (i: number, a: Action) => void = () => {}) => Array.from({ length: n }, (_, i) => { const a = noop(); set(i, a); return a; });
const fireFrom = (g: Game, id: number) => acts(g.n, (i, a) => { a.fire = i === id; });

describe("deterministic math", () => {
  it("sin/cos/atan2 match Math within 1e-9", () => {
    for (let x = -10; x <= 10; x += 0.37) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-9);
      expect(Math.abs(atan2(x, 1.3) - Math.atan2(x, 1.3))).toBeLessThan(1e-9);
      expect(Math.abs(atan2(-1.1, x) - Math.atan2(-1.1, x))).toBeLessThan(1e-9);
    }
  });
});

describe("determinism", () => {
  it("same seed, same bots: the same match tick for tick", () => {
    const mk = () => new Match(5, { map: "base", mode: "ffa", scoreLimit: 10, slots: standardSlots("ffa", "hard", { spectate: true, seed: 5 }) });
    const a = mk(), b = mk();
    for (let t = 0; t < 3000; t++) {
      a.step(); b.step();
      if (t % 100 === 0) expect(a.game.hash()).toBe(b.game.hash());
    }
    expect(a.game.hash()).toBe(b.game.hash());
  });
  it("a replay (seed + human inputs) rebuilds the exact match", () => {
    const opts = { map: "ship" as const, mode: "team" as const, scoreLimit: 5, slots: standardSlots("team", "normal", { seed: 9, character: 2 }) };
    const m = new Match(9, opts);
    const r = new Rng(77);
    const a = noop();
    for (let t = 0; t < 2500 && !m.over; t++) {
      // a jittery "human": random movement, mouse turns, bursts of fire, the odd ability
      if (t % 20 === 0) { a.forward = r.int(3) - 1; a.strafe = r.int(3) - 1; a.fire = r.int(3) === 0; a.crouch = r.int(6) === 0; }
      a.yaw = (r.float() - 0.5) * 0.05; a.pitch = (r.float() - 0.5) * 0.01;
      a.jump = r.int(50) === 0; a.ability = r.int(200) === 0;
      m.step([a]);
    }
    const rep = JSON.parse(JSON.stringify(m.replay()));
    const again = Match.fromReplay(rep);
    expect(again.game.hash()).toBe(m.game.hash());
    expect(again.game.teamScore).toEqual(m.game.teamScore);
  });
  it("different seeds give different matches", () => {
    const run = (seed: number) => { const m = new Match(seed, { map: "base", mode: "duel", scoreLimit: 10, slots: standardSlots("duel", "normal", { spectate: true, seed }) }); for (let i = 0; i < 600; i++) m.step(); return m.game.hash(); };
    expect(run(1)).not.toBe(run(2));
  });
});

describe("hitscan and body parts", () => {
  const shoot = (part: "head" | "torso" | "legs") => {
    const g = lab();
    place(g, 0, 11, -8); place(g, 1, 11, 2);
    const y = { head: (C.HITBOX.head.y0 + C.HITBOX.head.y1) / 2, torso: (C.HITBOX.torso.y0 + C.HITBOX.torso.y1) / 2, legs: (C.HITBOX.legs.y0 + C.HITBOX.legs.y1) / 2 }[part];
    aimAt(g, 0, 1, y);
    g.step(fireFrom(g, 0));
    return g;
  };
  it("head x2.5, torso x1, legs x0.75", () => {
    expect(C.MAX_HEALTH - shoot("head").agents[1].health).toBe(C.BASE_DAMAGE * 2.5);
    expect(C.MAX_HEALTH - shoot("torso").agents[1].health).toBe(C.BASE_DAMAGE);
    expect(C.MAX_HEALTH - shoot("legs").agents[1].health).toBe(C.BASE_DAMAGE * 0.75);
    const g = shoot("head");
    expect(g.agents[0].headshots).toBe(1);
    expect(g.events.find((e) => e.type === "hit")).toMatchObject({ part: "head", dmg: 50 });
  });
  it("crouching lowers the hitboxes: a shot at standing head height misses", () => {
    const g = lab();
    place(g, 0, 11, -8); place(g, 1, 11, 2);
    g.step(acts(2, (i, a) => { a.crouch = i === 1; }));
    expect(g.agents[1].crouch).toBe(true);
    aimAt(g, 0, 1, 1.6);
    g.step(acts(2, (i, a) => { a.fire = i === 0; a.crouch = i === 1; }));
    expect(g.agents[1].health).toBe(C.MAX_HEALTH);
  });
  it("cover stops lasers", () => {
    const g = lab();
    // a 1.2 m crate at (-12.6, -6.5); the target crouches behind it
    place(g, 0, -12.6, -14); place(g, 1, -12.6, -5.2);
    g.step(acts(2, (i, a) => { a.crouch = i === 1; }));
    aimAt(g, 0, 1, 0.75);
    g.step(acts(2, (i, a) => { a.fire = i === 0; a.crouch = i === 1; }));
    expect(g.agents[1].health).toBe(C.MAX_HEALTH);
    expect(g.events.find((e) => e.type === "shot")).toMatchObject({ target: -1, surface: 2 });
  });
  it("friendly fire is off in 2v2 (the teammate blocks, takes nothing)", () => {
    const g = lab({ mode: "team" });
    place(g, 0, 11, -8); place(g, 1, 11, 2); place(g, 2, -5, -20); place(g, 3, 5, -20);
    aimAt(g, 0, 1, 1.1);
    g.step(fireFrom(g, 0));
    expect(g.agents[1].health).toBe(C.MAX_HEALTH);
    expect(g.agents[0].hits).toBe(0);
  });
});

describe("reveal rules", () => {
  it("a robot you hit stays outlined for you for 2 s", () => {
    const g = lab();
    place(g, 0, 11, -8); place(g, 1, 11, 2);
    aimAt(g, 0, 1, 1.1);
    g.step(fireFrom(g, 0));
    expect(g.agents[1].outlineFor[0]).toBe(C.OUTLINE_TICKS);
    for (let i = 0; i < C.OUTLINE_TICKS - 1; i++) g.step(acts(2));
    expect(g.agents[1].outlineFor[0]).toBe(1);
    g.step(acts(2));
    expect(g.agents[1].outlineFor[0]).toBe(0);
  });
  it("firing pings the shooter on the minimap for 1 s (the AI gets it as a memory slot)", () => {
    const g = lab();
    place(g, 0, 11, -8); place(g, 1, -11, 8);
    g.agents[0].yaw = Math.PI / 2;
    g.step(fireFrom(g, 0));
    expect(g.agents[0].pingTicks).toBe(C.PING_TICKS);
    const o = observe(g, 1, new Observation());
    expect(o.memSource[0]).toBe(MEM_PING);
    expect(o.memX[0]).toBeCloseTo(11);
    for (let i = 0; i < C.PING_TICKS; i++) g.step(acts(2));
    expect(observe(g, 1, new Observation()).memSource[0]).toBe(0);
  });
  it("15 s without moving or shooting reveals you", () => {
    const g = lab();
    place(g, 0, 11, -8); place(g, 1, -11, 8);
    let revealedAt = -1;
    for (let t = 0; t < C.IDLE_REVEAL_AFTER + 10; t++) {
      // robot 1 keeps walking back and forth, robot 0 stands still
      g.step(acts(2, (i, a) => { if (i === 1) a.strafe = (t >> 5) & 1 ? 1 : -1; }));
      if (revealedAt < 0 && g.events.some((e) => e.type === "reveal" && e.a === 0)) revealedAt = g.tick;
    }
    expect(revealedAt).toBe(C.IDLE_REVEAL_AFTER);
    expect(g.agents[0].revealTicks).toBeGreaterThan(0);
    expect(g.agents[1].revealTicks).toBe(0);
  });
});

describe("scoring, respawn, protection", () => {
  it("an elimination scores, the robot respawns protected, and the match ends at the limit", () => {
    const g = lab({ scoreLimit: 2 });
    const killOnce = () => {
      place(g, 0, 11, -8); place(g, 1, 11, 2);
      aimAt(g, 0, 1, 1.6);
      g.step(fireFrom(g, 0));
      for (let i = 0; i < C.FIRE_TICKS; i++) g.step(acts(2));
      aimAt(g, 0, 1, 1.6);
      g.step(fireFrom(g, 0));
    };
    killOnce();
    expect(g.agents[1].alive).toBe(false);
    expect(g.agents[0].kills).toBe(1);
    expect(g.teamScore).toEqual([1, 0]);
    expect(g.over).toBe(false);
    for (let i = 0; i < C.RESPAWN_TICKS; i++) g.step(acts(2));
    expect(g.agents[1].alive).toBe(true);
    expect(g.agents[1].protectTicks).toBeGreaterThan(0);
    // protected: hits do no damage
    place(g, 0, 11, -8); g.agents[1].x = 11; g.agents[1].z = 2; g.agents[1].protectTicks = 60;
    aimAt(g, 0, 1, 1.1);
    for (let i = 0; i < C.FIRE_TICKS; i++) g.step(acts(2));
    g.step(fireFrom(g, 0));
    expect(g.events.find((e) => e.type === "hit")).toMatchObject({ blocked: true, dmg: 0 });
    expect(g.agents[1].health).toBe(C.MAX_HEALTH);
    for (let i = 0; i < 70; i++) g.step(acts(2));
    killOnce();
    expect(g.over).toBe(true);
    expect(g.winnerTeam).toBe(0);
    expect(g.events.some((e) => e.type === "end")).toBe(true);
  });
  it("2v2: team score is the sum of the team's eliminations", () => {
    const m = new Match(4, { map: "base", mode: "team", scoreLimit: 6, slots: standardSlots("team", "hard", { spectate: true, seed: 4 }) });
    while (!m.over && m.tick < 60 * 60 * 15) m.step();
    const g = m.game;
    expect(g.over).toBe(true);
    expect(g.teamScore[0]).toBe(g.agents[0].kills + g.agents[1].kills);
    expect(g.teamScore[1]).toBe(g.agents[2].kills + g.agents[3].kills);
    expect(Math.max(...g.teamScore)).toBe(6);
  });
});

describe("spawn protection", () => {
  it("ends after exactly PROTECT_TICKS without firing, and at once when firing", () => {
    const g = new Game(3, { map: "base", mode: "duel" });
    expect(g.agents[0].protectTicks).toBe(C.PROTECT_TICKS);
    for (let i = 0; i < C.PROTECT_TICKS - 1; i++) g.step(acts(2));
    expect(g.agents[0].protectTicks).toBe(1);
    g.step(acts(2));
    expect(g.agents[0].protectTicks).toBe(0);
    const h = new Game(3, { map: "base", mode: "duel" });
    h.step(fireFrom(h, 0));
    expect(h.agents[0].protectTicks).toBe(0);
  });
});

describe("abilities", () => {
  it("Bulwark's shield stops lasers from the front, not from behind", () => {
    const front = lab({ characters: [0, 1] });
    place(front, 0, 11, -8); place(front, 1, 11, 2);
    front.agents[1].yaw = 0; // facing north, toward the shooter
    front.step(acts(2, (i, a) => { a.ability = i === 1; }));
    aimAt(front, 0, 1, 1.1);
    front.step(fireFrom(front, 0));
    expect(front.agents[1].health).toBe(C.MAX_HEALTH);
    expect(front.events.some((e) => e.type === "blocked")).toBe(true);
    const back = lab({ characters: [0, 1] });
    place(back, 0, 11, -8); place(back, 1, 11, 2);
    back.agents[1].yaw = Math.PI; // facing away
    back.step(acts(2, (i, a) => { a.ability = i === 1; }));
    aimAt(back, 0, 1, 1.1);
    back.step(fireFrom(back, 0));
    expect(back.agents[1].health).toBe(C.MAX_HEALTH - C.BASE_DAMAGE);
  });
  it("the AI's rays see an enemy shield as its own label", () => {
    const g = lab({ characters: [0, 1] });
    place(g, 0, 11, -8); place(g, 1, 11, 2);
    g.agents[1].yaw = 0;
    aimAt(g, 0, 1, 1.1);
    g.step(acts(2, (i, a) => { a.ability = i === 1; }));
    const o = observe(g, 0, new Observation());
    expect(Array.from(o.label).filter((l) => l === L_SHIELD).length).toBeGreaterThan(10);
  });
  it("Dash's dash moves ~2.8 m in a sixth of a second, then cools down 6 s", () => {
    const g = lab({ characters: [0, 1] });
    place(g, 0, 11, -8); place(g, 1, -11, 8);
    g.agents[0].yaw = Math.PI; // facing south, down the corridor
    g.step(acts(2, (i, a) => { a.ability = i === 0; }));
    for (let i = 0; i < C.DASH_TICKS; i++) g.step(acts(2));
    expect(g.agents[0].z - -8).toBeGreaterThan(2.6);
    expect(g.agents[0].abilityCooldown).toBeGreaterThan(C.DASH_COOLDOWN - 20);
  });
  it("Echo's scan reveals enemies within 20 m through walls to the scanner's team", () => {
    const g = lab({ characters: [2, 0] });
    place(g, 0, 0, 5); place(g, 1, 12, 5); // a bulkhead between them
    expect(observe(g, 0, new Observation()).memSource[1]).toBe(0);
    g.step(acts(2, (i, a) => { a.ability = i === 0; }));
    expect(observe(g, 0, new Observation()).memSource[1]).toBe(MEM_SCAN);
    for (let i = 0; i < C.SCAN_REVEAL_TICKS; i++) g.step(acts(2));
    expect(observe(g, 0, new Observation()).memSource[1]).toBe(0);
  });
  it("Wisp's cloak hides it from the AI's rays beyond 6 m; firing breaks it", () => {
    const g = lab({ characters: [0, 3] });
    place(g, 0, 11, -8); place(g, 1, 11, 2);
    aimAt(g, 0, 1, 1.1);
    const seen = () => Array.from(observe(g, 0, new Observation()).label).some((l) => l === L_HEAD || l === L_TORSO || l === L_LEGS);
    expect(seen()).toBe(true);
    g.step(acts(2, (i, a) => { a.ability = i === 1; }));
    expect(seen()).toBe(false);
    place(g, 1, 11, -3); // 5 m away: close enough to make out
    aimAt(g, 0, 1, 1.1);
    expect(seen()).toBe(true);
    place(g, 1, 11, 2);
    g.step(fireFrom(g, 1));
    aimAt(g, 0, 1, 1.1);
    expect(seen()).toBe(true);
  });
});

describe("observation", () => {
  it("has a fixed size and labels a visible enemy's parts and teammates", () => {
    const g = lab({ mode: "team" });
    place(g, 0, 11, -8); place(g, 2, 11, 2); place(g, 1, 11.9, -4); place(g, 3, -11, -20);
    aimAt(g, 0, 2, 1.1);
    const o = observe(g, 0, new Observation());
    const labels = new Set(o.label);
    expect(labels.has(L_TORSO)).toBe(true);
    expect(labels.has(L_HEAD)).toBe(true);
    expect(labels.has(L_MATE)).toBe(true);
    const v = encodeObs(o, new Float32Array(OBS_SIZE));
    expect(v.length).toBe(OBS_SIZE);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
    expect(N_RAYS).toBe(256);
  });
  it("no wall hacks: an enemy behind a wall is not in the rays", () => {
    const g = lab();
    place(g, 0, 0, 5); place(g, 1, 12, 5); // the bay wall is between them
    aimAt(g, 0, 1, 1.1);
    const o = observe(g, 0, new Observation());
    expect(Array.from(o.agent).every((x) => x === -1)).toBe(true);
    expect(o.memSource[1]).toBe(0);
  });
});
