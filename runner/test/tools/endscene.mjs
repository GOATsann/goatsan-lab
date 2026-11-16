// End scene on any death + bigger, higher chase ghost. node test/tools/endscene.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5180/?seed=7");
await p.waitForTimeout(3000);
await p.click("#play");
const st = () => p.evaluate(() => { const g = window.game(); return { tick: g.tick, dead: g.dead, cause: g.deathCause, chaser: g.chaserTicks, overlay: !document.getElementById("overlay").hidden }; });
// first: a stumble for the chase frame (run straight); then steer into a train for a head-on crash
let chased = false;
for (let i = 0; i < 400; i++) {
  await p.waitForTimeout(80);
  const s = await st();
  if (!chased && s.chaser > 230) { await p.screenshot({ path: `${out}/end-chase.png` }); chased = true;
    // make the next hit a train: drop a standing train right ahead in the runner's lane
    await p.evaluate(() => { const g = window.game(); g.chaserTicks = 0; g.stumbleCount = 0; g.obstacles.push({ id: 99999, kind: "train", lane: g.lane, z0: g.z + 25000, z1: g.z + 45000, moving: false, awake: false, broken: false }); });
  }
  if (s.dead) break;
}
const ghostPos = () => p.evaluate(() => { const r = window.renderer ?? null; return null; });
await p.waitForTimeout(1000);
console.log("dead", JSON.stringify(await st()));
await p.screenshot({ path: `${out}/end-scene.png` });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/end-card-a.png` });
await p.waitForTimeout(900);
await p.screenshot({ path: `${out}/end-card-b.png` });
console.log("card", JSON.stringify(await st()), "errors:", errs.length ? errs : "none");
await b.close();
