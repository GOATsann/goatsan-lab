import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const replay = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto("http://localhost:5180/replay.html");
await p.waitForFunction(() => "replayApi" in window);
await p.evaluate((r) => window.replayApi.load(r, ""), replay);
for (const t of [0, 4, 40, 300]) {
  if (t) await p.evaluate((n) => window.replayApi.frame(n), t === 4 ? 4 : t - 4);
  console.log(t, await p.evaluate(() => { const c = window.renderer.camera; return JSON.stringify({ pos: c.position.toArray().map((v) => +v.toFixed(2)), rot: c.rotation.toArray().slice(0, 3).map((v) => +v.toFixed(2)), fov: +c.fov.toFixed(1), aspect: +c.aspect.toFixed(2) }); }));
}
await b.close();
