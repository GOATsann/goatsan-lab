// Download the AI opponents (not in git) from Hugging Face into public/models before a build.
// Pinned: models.lock.json names the repo, an exact revision, and the sha256 of every file.
// Files already present with the right checksum are kept; anything else is downloaded and checked.
//   npm run fetch-models        (also runs automatically before npm run build)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { VERSION } from "../core/game";
import { OBS_SIZE } from "../core/obs";

const lock = JSON.parse(readFileSync("models.lock.json", "utf8")) as { repo: string; revision: string; files: Record<string, string> };
const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");
mkdirSync("public/models", { recursive: true });

for (const [name, want] of Object.entries(lock.files)) {
  const path = `public/models/${name}`;
  if (existsSync(path) && sha256(readFileSync(path)) === want) continue;
  const url = `https://huggingface.co/${lock.repo}/resolve/${lock.revision}/${name}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer());
  if (sha256(data) !== want) throw new Error(`${name}: checksum mismatch (got ${sha256(data).slice(0, 12)}, want ${want.slice(0, 12)})`);
  writeFileSync(path, data);
  console.log(`fetched ${name} (${data.length.toLocaleString()} bytes)`);
}
// the game refuses models made for other rules; check here too, so a stale lock fails the build early
for (const name of Object.keys(lock.files).filter((n) => n.endsWith(".json"))) {
  const info = JSON.parse(readFileSync(`public/models/${name}`, "utf8"));
  if (info.version !== VERSION || info.obs_size !== OBS_SIZE)
    throw new Error(`${name} is for rules v${info.version} / obs ${info.obs_size}; the game is v${VERSION} / obs ${OBS_SIZE}`);
}
console.log(`models ok: ${Object.keys(lock.files).length} files from ${lock.repo}@${lock.revision.slice(0, 7)}`);
