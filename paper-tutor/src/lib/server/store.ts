import "server-only";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

// The one storage interface. Locally it is plain files under .data/ (gitignored). On AWS the same interface
// gets a DynamoDB (JSON records) + S3 (blobs) implementation, and nothing above this file changes.
export interface Store {
  getJSON<T>(key: string): Promise<T | null>;
  putJSON(key: string, value: unknown): Promise<void>;
  getBlob(key: string): Promise<Buffer | null>;
  putBlob(key: string, data: Buffer | Uint8Array): Promise<void>;
  has(key: string): Promise<boolean>;
}

// Keys look like "papers/1706.03762/meta.json". Only these characters reach the file system.
function safeKey(key: string): string {
  if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`bad store key: ${key}`);
  }
  return key;
}

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

  async getJSON<T>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(key), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async putJSON(key: string, value: unknown) {
    await this.write(key, JSON.stringify(value, null, 1));
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

export function getStore(): Store {
  store ??= new FileStore(process.env.PAPER_TUTOR_DATA_DIR || path.join(process.cwd(), ".data"));
  return store;
}
