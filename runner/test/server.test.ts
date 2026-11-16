import { spawn } from "node:child_process";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Game, type Replay } from "../src/core/game";
import { OBS_SIZE } from "../src/core/obs";

const PORT = 7391, N = 16;
let proc: ReturnType<typeof spawn>;
let sock: net.Socket;
let buf = Buffer.alloc(0);
const waiters: ((b: Buffer) => void)[] = [];

function send(body: Buffer): Promise<Buffer> {
  const len = Buffer.alloc(4); len.writeUInt32LE(body.length);
  sock.write(Buffer.concat([len, body]));
  return new Promise((r) => waiters.push(r));
}

beforeAll(async () => {
  proc = spawn("npx", ["tsx", "src/headless/server.ts", "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((r) => proc.stdout!.on("data", (d) => String(d).includes("on 127.0.0.1") && r()));
  sock = net.connect(PORT, "127.0.0.1");
  sock.on("data", (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
      const n = buf.readUInt32LE(0); const m = buf.subarray(4, 4 + n); buf = buf.subarray(4 + n);
      waiters.shift()!(Buffer.from(m));
    }
  });
  await new Promise((r) => sock.on("connect", r));
}, 30000);
afterAll(() => { sock?.destroy(); proc?.kill(); });

describe("batch server", () => {
  let hello: { obs_size: number; event_fields: string[]; death_causes: string[] };
  it("handshake", async () => {
    hello = JSON.parse((await send(Buffer.from(JSON.stringify({ n_envs: N, seed_base: 5000, max_ticks: 600 })))).toString());
    expect(hello.obs_size).toBe(OBS_SIZE);
    expect(hello.event_fields).toContain("died");
  });
  it("reset, step, auto-reset, replays, fixed seeds", async () => {
    const r = await send(Buffer.from([1]));
    expect(r.length).toBe(N * OBS_SIZE * 4);
    const NEV = hello.event_fields.length;
    let finished = 0, truncs = 0, steps = 0;
    const t0 = performance.now();
    for (; steps < 400; steps++) {
      const actions = Buffer.alloc(1 + N); actions[0] = 2;
      for (let i = 0; i < N; i++) actions[1 + i] = steps % 7 === 0 ? 3 : 0;
      const m = await send(actions);
      let o = N * OBS_SIZE * 4;
      const ev = new Float32Array(m.buffer.slice(m.byteOffset + o, m.byteOffset + o + N * NEV * 4)); o += N * NEV * 4;
      const term = m.subarray(o, o + N); o += N;
      const trunc = m.subarray(o, o + N); o += N;
      const cause = m.subarray(o, o + N); o += N;
      o += N * 4; // seeds
      const nDone = m.readUInt16LE(o); o += 2;
      expect(m.length).toBe(o + nDone * (2 + OBS_SIZE * 4));
      for (let i = 0; i < N; i++) {
        if (term[i]) { finished++; expect(cause[i]).toBeGreaterThan(0); expect(ev[i * NEV + 7]).toBe(1); }
        if (trunc[i]) truncs++;
      }
      if (nDone) {
        const env = m.readUInt16LE(o);
        const rep = JSON.parse((await send(Buffer.from([3, env & 255, env >> 8]))).toString()) as Replay;
        const g = Game.fromReplay(rep);
        expect(g.dead || g.tick >= 600).toBe(true);
      }
    }
    const perSec = (steps * N) / ((performance.now() - t0) / 1000);
    console.log(`finished ${finished}, truncated ${truncs}, ${Math.round(perSec)} env-decisions/s over TCP (${N} envs)`);
    expect(finished + truncs).toBeGreaterThan(0);
    const fixed = Buffer.alloc(7); fixed[0] = 4; fixed.writeUInt16LE(3, 1); fixed.writeUInt32LE(1000, 3);
    expect((await send(fixed)).length).toBe(OBS_SIZE * 4);
  }, 60000);
});
