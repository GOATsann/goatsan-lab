// Batch game server for the Python trainer. Protocol: ../../PROTOCOL.md
//   npm run server -- --port 7001
// One TCP client; it owns n_envs games and steps them all per message.
import net from "node:net";
import { DECISION_TICKS } from "../core/config";
import { DEATH_CAUSES, Game, VERSION, type Action, type Events, type Replay } from "../core/game";
import { OBS_SIZE, observe } from "../core/obs";

const EVENT_FIELDS = ["distance", "coins", "powerups", "jumps", "rolls", "laneChanges", "stumbles", "died", "score", "meters", "ticks"] as const;
const NEV = EVENT_FIELDS.length;
const N_ACTIONS = 5;

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const port = Number(arg("port", "7001"));

interface Hello { n_envs: number; seed_base: number; max_ticks: number }

class Batch {
  games: Game[];
  episode: number[]; // episodes started per env (for the seed stream)
  lastReplay: (Replay | null)[];
  constructor(readonly hello: Hello) {
    const n = hello.n_envs;
    this.episode = new Array(n).fill(0);
    this.lastReplay = new Array(n).fill(null);
    this.games = Array.from({ length: n }, (_, i) => this.fresh(i));
  }
  private fresh(i: number): Game {
    const seed = this.hello.seed_base + this.episode[i] * this.hello.n_envs + i;
    this.episode[i]++;
    return new Game(seed);
  }
  resetAll(): Buffer {
    this.games = this.games.map((_, i) => this.fresh(i));
    const obs = new Float32Array(this.games.length * OBS_SIZE);
    this.games.forEach((g, i) => observe(g, obs.subarray(i * OBS_SIZE, (i + 1) * OBS_SIZE)));
    return Buffer.from(obs.buffer);
  }
  resetTo(env: number, seed: number): Buffer {
    this.games[env] = new Game(seed);
    const obs = new Float32Array(OBS_SIZE);
    observe(this.games[env], obs);
    return Buffer.from(obs.buffer);
  }
  step(actions: Uint8Array): Buffer {
    const n = this.games.length;
    const obs = new Float32Array(n * OBS_SIZE);
    const ev = new Float32Array(n * NEV);
    const term = new Uint8Array(n), trunc = new Uint8Array(n), cause = new Uint8Array(n);
    const seeds = new Uint32Array(n);
    const done: { env: number; obs: Float32Array }[] = [];
    for (let i = 0; i < n; i++) {
      let g = this.games[i];
      const e: Events = g.decide(actions[i] as Action);
      seeds[i] = g.seed;
      const row = ev.subarray(i * NEV, (i + 1) * NEV);
      row[0] = e.distance; row[1] = e.coins; row[2] = e.powerups; row[3] = e.jumps; row[4] = e.rolls;
      row[5] = e.laneChanges; row[6] = e.stumbles; row[7] = e.died; row[8] = g.score; row[9] = g.meters; row[10] = g.tick;
      term[i] = g.dead ? 1 : 0;
      trunc[i] = !g.dead && g.tick >= this.hello.max_ticks ? 1 : 0;
      cause[i] = DEATH_CAUSES.indexOf(g.deathCause as (typeof DEATH_CAUSES)[number]);
      const slot = obs.subarray(i * OBS_SIZE, (i + 1) * OBS_SIZE);
      if (term[i] || trunc[i]) {
        const last = new Float32Array(OBS_SIZE);
        observe(g, last);
        done.push({ env: i, obs: last });
        this.lastReplay[i] = g.replay();
        g = this.games[i] = this.fresh(i);
      }
      observe(g, slot);
    }
    const parts: Buffer[] = [
      Buffer.from(obs.buffer), Buffer.from(ev.buffer), Buffer.from(term), Buffer.from(trunc), Buffer.from(cause),
      Buffer.from(seeds.buffer),
    ];
    const head = Buffer.alloc(2);
    head.writeUInt16LE(done.length);
    parts.push(head);
    for (const d of done) {
      const e = Buffer.alloc(2);
      e.writeUInt16LE(d.env);
      parts.push(e, Buffer.from(d.obs.buffer));
    }
    return Buffer.concat(parts);
  }
}

function frame(body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
}

const server = net.createServer((sock) => {
  sock.setNoDelay(true);
  let buf = Buffer.alloc(0);
  let batch: Batch | null = null;
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const msg = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      try {
        if (!batch) {
          const hello = JSON.parse(msg.toString("utf8")) as Hello;
          batch = new Batch(hello);
          sock.write(frame(Buffer.from(JSON.stringify({
            version: VERSION, obs_size: OBS_SIZE, n_actions: N_ACTIONS, decision_ticks: DECISION_TICKS,
            event_fields: EVENT_FIELDS, death_causes: DEATH_CAUSES,
          }))));
          continue;
        }
        const cmd = msg[0];
        if (cmd === 1) sock.write(frame(batch.resetAll()));
        else if (cmd === 2) sock.write(frame(batch.step(msg.subarray(1, 1 + batch.games.length))));
        else if (cmd === 3) {
          const env = msg.readUInt16LE(1);
          sock.write(frame(Buffer.from(JSON.stringify(batch.lastReplay[env]))));
        } else if (cmd === 4) sock.write(frame(batch.resetTo(msg.readUInt16LE(1), msg.readUInt32LE(3))));
        else if (cmd === 0) { sock.end(); server.close(); }
        else throw new Error(`unknown command ${cmd}`);
      } catch (err) {
        console.error(err);
        sock.destroy();
        server.close();
        process.exitCode = 1;
      }
    }
  });
});
server.listen(port, "127.0.0.1", () => console.log(`runner server v${VERSION} on 127.0.0.1:${port}`));
