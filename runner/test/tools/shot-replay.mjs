// Screenshot the replay page at given ticks (phone size): node test/tools/shot-replay.mjs <replay.json> <outprefix> t1 t2 ...
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [file, prefix, ...ticks] = process.argv.slice(2);
const replay = JSON.parse(readFileSync(file, "utf8"));
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5180/replay.html");
await p.waitForFunction(() => "replayApi" in window);
await p.evaluate((r) => window.replayApi.load(r, "light check"), replay);
let at = 0;
for (const t of ticks.map(Number)) {
  while (at < t) { const n = Math.min(4, t - at); await p.evaluate((n) => window.replayApi.frame(n), n); at += n; }
  await p.screenshot({ path: `${prefix}-${t}.png` });
}
console.log("errors:", errs.length ? errs : "none");
await b.close();
