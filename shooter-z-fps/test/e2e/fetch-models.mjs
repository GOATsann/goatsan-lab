// Download the game's AI models into public/models/ (gitignored) from Hugging Face, at the revision pinned in
// models.lock.json, and check every file's sha256. Used by CI before the e2e tests (the models are never in git).
//   node test/e2e/fetch-models.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(readFileSync(join(root, "models.lock.json"), "utf8"));
// game file name <- file in the Hugging Face repo (Hard = top level, Easy = easy/)
const MAP = {
  "shooter-ai-34m.onnx": "policy.onnx", "shooter-ai-34m.json": "policy.json",
  "shooter-ai-28m.onnx": "easy/policy.onnx", "shooter-ai-28m.json": "easy/policy.json",
};
const out = join(root, "public", "models");
mkdirSync(out, { recursive: true });
for (const [local, remote] of Object.entries(MAP)) {
  const want = lock.files[remote];
  if (!want) throw new Error(`models.lock.json has no ${remote}`);
  const dest = join(out, local);
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  if (existsSync(dest) && sha(readFileSync(dest)) === want) { console.log(`${local}: up to date`); continue; }
  const url = `https://huggingface.co/${lock.repo}/resolve/${lock.revision}/${remote}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== want) throw new Error(`${remote}: checksum mismatch`);
  writeFileSync(dest, buf);
  console.log(`${local}: downloaded (${(buf.length / 1e6).toFixed(1)} MB)`);
}
