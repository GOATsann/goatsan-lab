import "server-only";
import { mkdir, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { safeKey, type CountResult, type Store } from "./store-key";

export type { CountResult, Store };

// The one storage interface. Locally it is plain files under .data/ (gitignored); on AWS it is DynamoDB (JSON
// records, counters, locks) plus S3 (blobs) in store-aws.ts, and nothing above this file changes.
// The atomic operations (create-if-absent, counters, add, rate slots) are what make limits, the one-writer locks
// and the arXiv queue correct when many server instances run at once.
type Counter = { n: number; ids?: string[]; total?: number; next?: number; expireAt?: number };

class FileStore implements Store {
  constructor(private root: string) {}

  private file(key: string) {
    return path.join(this.root, safeKey(key));
  }

  private async write(key: string, data: Buffer | Uint8Array | string) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Write then rename, so a reader never sees half a file.
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }

  // One process locally, so a promise chain per key makes read-modify-write atomic.
  private locks = new Map<string, Promise<unknown>>();
  private locked<T>(k: string, job: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(k) ?? Promise.resolve()).then(job, job);
    this.locks.set(k, run.catch(() => undefined));
    return run;
  }

  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const v = JSON.parse(await readFile(this.file(key), "utf8")) as T & { expireAt?: number };
      if (v && typeof v === "object" && typeof v.expireAt === "number" && v.expireAt * 1000 < Date.now()) return null;
      return v;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async putJSON(key: string, value: unknown, opts?: { ttlSec?: number }) {
    const v = opts?.ttlSec ? { ...(value as object), expireAt: Math.floor(Date.now() / 1000) + opts.ttlSec } : value;
    await this.write(key, JSON.stringify(v, null, 1));
  }

  async getBlob(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async putBlob(key: string, data: Buffer | Uint8Array) {
    await this.write(key, data);
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }

  createJSON(key: string, value: unknown, opts: { ttlSec: number }) {
    return this.locked(key, async () => {
      if (await this.getJSON(key)) return false;
      await this.putJSON(key, value, opts);
      return true;
    });
  }

  count(key: string, opts: { max: number; member?: string; ttlSec: number }) {
    return this.locked(key, async (): Promise<CountResult> => {
      const c = (await this.getJSON<Counter>(key)) ?? { n: 0 };
      if (opts.member && c.ids?.includes(opts.member)) return "already";
      if (c.n >= opts.max) return "full";
      const next: Counter = { n: c.n + 1, ...(opts.member ? { ids: [...(c.ids ?? []), opts.member] } : {}) };
      await this.putJSON(key, next, { ttlSec: opts.ttlSec });
      return "counted";
    });
  }

  add(key: string, amount: number, opts: { ttlSec: number }) {
    return this.locked(key, async () => {
      const c = (await this.getJSON<Counter>(key)) ?? { n: 0 };
      const total = (c.total ?? 0) + amount;
      await this.putJSON(key, { ...c, total }, { ttlSec: opts.ttlSec });
      return total;
    });
  }

  reserveSlot(key: string, gapMs: number) {
    return this.locked(key, async () => {
      const now = Date.now();
      const c = (await this.getJSON<Counter>(key)) ?? { n: 0 };
      const at = Math.max(now, c.next ?? 0);
      await this.putJSON(key, { n: 0, next: at + gapMs }, { ttlSec: 3600 });
      return at - now;
    });
  }

  async has(key: string) {
    try {
      await stat(this.file(key));
      return true;
    } catch {
      return false;
    }
  }
}

let store: Store | null = null;

// AWS when the tables exist (set by sst.config.ts), else files.
export function getStore(): Store {
  if (store) return store;
  if (process.env.PAPERS_TABLE && process.env.FILES_BUCKET) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AwsStore } = require("./store-aws") as typeof import("./store-aws");
    store = new AwsStore({ table: process.env.PAPERS_TABLE, bucket: process.env.FILES_BUCKET });
  } else {
    store = new FileStore(process.env.PAPER_TUTOR_DATA_DIR || path.join(process.cwd(), ".data"));
  }
  return store;
}
