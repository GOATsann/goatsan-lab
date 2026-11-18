import { connect } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { ACTION_SIZE } from "../src/core/actions";
import { Match, type Replay } from "../src/core/match";
import { OBS_SIZE } from "../src/core/obs";
import { Batch, EVENT_FIELDS, listen } from "../src/headless/server";

describe("batch (in process)", () => {
  it("steps many envs, auto-resets with a terminal obs, and the replay rebuilds the episode", () => {
    const b = new Batch({ n_envs: 3, seed_base: 1000, max_ticks: 900, mode: "duel", score_limit: 2 });
    const obs = b.resetAll();
    expect(obs.length).toBe(3 * OBS_SIZE);
    const acts = new Float32Array(3 * ACTION_SIZE);
    let finished = 0;
    for (let s = 0; s < 400 && finished < 3; s++) {
      for (let i = 0; i < 3; i++) { acts[i * ACTION_SIZE + 4] = 0.3; acts[i * ACTION_SIZE + 6] = 1; acts[i * ACTION_SIZE] = s % 40 < 20 ? 1 : 0; }
      const r = b.step(acts);
      expect(r.events.length).toBe(3 * EVENT_FIELDS.length);
      for (const d of r.done) {
        finished++;
        expect(d.obs.length).toBe(OBS_SIZE);
        expect(r.terminated[d.env] + r.truncated[d.env]).toBe(1);
        const rep = JSON.parse(JSON.stringify(b.envs[d.env].lastReplay)) as Replay;
        expect(Match.fromReplay(rep).game.hash()).toBe(rep.hash);
      }
    }
    expect(finished).toBeGreaterThan(0); // 900-tick cut-off = 300 decisions
  });
});

describe("batch server over TCP", () => {
  const srv = listen(7391);
  afterAll(() => srv.close());
  it("handshake, reset, step, fixed seed, replay, close", async () => {
    const sock = connect(7391, "127.0.0.1");
    await new Promise<void>((r) => sock.once("connect", () => r()));
    let buf = Buffer.alloc(0);
    const waiters: ((b: Buffer) => void)[] = [];
    sock.on("data", (c) => {
      buf = Buffer.concat([buf, c]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
        const len = buf.readUInt32LE(0);
        const body = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        waiters.shift()!(Buffer.from(body));
      }
    });
    const send = (body: Buffer) => new Promise<Buffer>((r) => { waiters.push(r); const h = Buffer.alloc(4); h.writeUInt32LE(body.length); sock.write(Buffer.concat([h, body])); });
    const hello = JSON.parse((await send(Buffer.from(JSON.stringify({ n_envs: 2, seed_base: 5000, max_ticks: 600, mode: "ffa" })))).toString());
    expect(hello.obs_size).toBe(OBS_SIZE);
    expect(hello.action_size).toBe(ACTION_SIZE);
    expect(hello.agents).toBe(4);
    const obs = await send(Buffer.from([1]));
    expect(obs.length).toBe(2 * OBS_SIZE * 4);
    const step = Buffer.alloc(1 + 2 * ACTION_SIZE * 4);
    step.writeUInt8(2, 0);
    const reply = await send(step);
    const nf = EVENT_FIELDS.length;
    expect(reply.length).toBe(2 * OBS_SIZE * 4 + 2 * nf * 4 + 2 + 2 + 2 + 2 * 4 + 2);
    const fixed = Buffer.alloc(7); fixed.writeUInt8(4, 0); fixed.writeUInt16LE(1, 1); fixed.writeUInt32LE(1234, 3);
    expect((await send(fixed)).length).toBe(OBS_SIZE * 4);
    const rep = Buffer.alloc(3); rep.writeUInt8(3, 0); rep.writeUInt16LE(0, 1);
    expect((await send(rep)).toString()).toBe("null"); // nothing finished yet
    sock.write(Buffer.from([1, 0, 0, 0, 0]));
    sock.end();
  });
});
