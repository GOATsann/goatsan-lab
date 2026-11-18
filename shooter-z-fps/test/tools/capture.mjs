// Render a capture.html scene frame by frame and encode it (mp4 with ffmpeg) or save one still (png).
//   node test/tools/capture.mjs "<query string>" <out.mp4|out.png> [fps] [seconds|stillTime]
// e.g. node test/tools/capture.mjs "scene=map&map=base&look=greybox&w=1920&h=1080&dur=6" out.mp4 30 6
// The dev server must be running (npm run dev, port 5190).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const [query, out, fpsArg, secArg] = process.argv.slice(2);
const params = new URLSearchParams(query);
const w = Number(params.get("w") ?? 1920), h = Number(params.get("h") ?? 1080);
const fps = Number(fpsArg ?? 30);
const isStill = out.endsWith(".png");
const seconds = Number(secArg ?? (isStill ? 0 : params.get("dur") ?? 6));

const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(`http://localhost:5190/capture.html?${query}`);
await p.waitForFunction(() => window.capture?.ready === true, null, { timeout: 60000 });
await p.waitForTimeout(500);

if (isStill) {
  await p.evaluate((t) => window.capture.frame(t), seconds);
  await p.screenshot({ path: out });
} else {
  const dir = mkdtempSync(join(tmpdir(), "shooterz-cap-"));
  const n = Math.round(fps * seconds);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.capture.frame(t), i / fps);
    await p.screenshot({ path: join(dir, `f${String(i).padStart(5, "0")}.png`) });
  }
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(dir, "f%05d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) errs.push("ffmpeg failed");
}
console.log(JSON.stringify({ out, errors: errs.length ? errs : "none" }));
await b.close();
