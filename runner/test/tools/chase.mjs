// Run with no input until stumble -> ghost -> caught -> blackout -> card. node test/tools/chase.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5180/?seed=7");
await p.waitForTimeout(3500);
await p.screenshot({ path: `${out}/card-start.png` });
await p.click("#play");
const state = () => p.evaluate(() => { const g = window.game(); return { tick: g.tick, dead: g.dead, cause: g.deathCause, stumbles: g.stumbleCount, chaser: g.chaserTicks,
  danger: getComputedStyle(document.querySelector("[data-danger]")).opacity, black: getComputedStyle(document.querySelector("[data-lightsout]")).opacity,
  icon: !document.querySelector("[data-chaser]").hidden, overlay: !document.getElementById("overlay").hidden }; });
let shotGhost = false, shotBlack = false, s;
for (let i = 0; i < 400; i++) {
  await p.waitForTimeout(100);
  s = await state();
  if (!shotGhost && s.chaser > 200) { await p.waitForTimeout(150); await p.screenshot({ path: `${out}/chase-ghost.png` }); console.log("ghost", JSON.stringify(await state())); shotGhost = true; }
  if (s.dead && !shotBlack) { await p.waitForTimeout(450); console.log("dead", JSON.stringify(await state())); await p.screenshot({ path: `${out}/chase-black.png` }); shotBlack = true; }
  if (s.dead && s.overlay) break;
}
await p.waitForTimeout(900);
console.log("card", JSON.stringify(await state()));
await p.screenshot({ path: `${out}/card-over.png` });
console.log("errors:", errs.length ? errs : "none");
await b.close();
