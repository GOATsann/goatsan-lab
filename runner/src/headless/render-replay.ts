// Render replays to mp4 with the real game renderer, frame by frame (exactly what happened).
//   npx tsx src/headless/render-replay.ts run1/progress_0100000.json [more.json ...] --outdir videos/run1
//     [--fps 30] [--size 720x1280] [--label "AI · run 1"] [--tail 1.5] [--character boy|girl|seed]
// --character seed (default) picks the runner from the track seed, so AI videos alternate.
// Needs Playwright's Chromium (npx playwright install chromium) and ffmpeg on PATH.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { TICK_HZ } from "../core/config";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const fps = Number(opt("fps", "30"));
const [w, h] = opt("size", "720x1280").split("x").map(Number);
const label = opt("label", "");
const tail = Number(opt("tail", "1.5"));
const outdir = opt("outdir", ".");
const character = opt("character", "seed");
const inputs = args;
if (!inputs.length) throw new Error("give one or more replay .json files");
const ticksPerFrame = TICK_HZ / fps;
if (!Number.isInteger(ticksPerFrame)) throw new Error(`fps must divide ${TICK_HZ}`);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vite = await createServer({ root, logLevel: "error", server: { port: 0, host: "127.0.0.1" } });
await vite.listen();
const url = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}/replay.html`;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto(url);
await page.waitForFunction(() => "replayApi" in window);
mkdirSync(outdir, { recursive: true });

for (const file of inputs) {
  const replay = JSON.parse(readFileSync(file, "utf8"));
  const out = join(outdir, basename(file).replace(/\.json$/, ".mp4"));
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = performance.now();
  const who = character === "seed" ? (replay.seed % 2 ? "girl" : "boy") : character;
  await page.evaluate((id) => (window as any).replayApi.character(id), who);
  await page.evaluate(([r, l]) => (window as any).replayApi.load(r, l), [replay, label || `track ${replay.seed}`]);
  let frames = 0, extra = Math.round(tail * fps), done = false;
  while (!done || extra-- > 0) {
    if (!done) done = await page.evaluate((n) => (window as any).replayApi.frame(n), ticksPerFrame);
    const jpg = await page.screenshot({ type: "jpeg", quality: 90 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    frames++;
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  const res = await page.evaluate(() => (window as any).replayApi.result());
  console.log(`${out}: ${frames} frames (${(frames / fps).toFixed(1)} s) in ${((performance.now() - t0) / 1000).toFixed(1)} s · score ${res.score}${res.dead ? `, ${res.cause}` : ""}`);
}
await browser.close();
await vite.close();
