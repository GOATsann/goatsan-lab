// Phone-size check of the v4 visuals: level picker, closer camera, effects, ghost chase, caught scene.
//   node test/tools/v4-visuals.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:5180/?seed=7");
await p.waitForTimeout(3500);
await p.click('[data-level="2"]');
await p.screenshot({ path: `${out}/v4-start.png` });
await p.click("#play");
await p.waitForTimeout(600);
// give the runner all four power-ups at once, to see every effect in one frame
await p.evaluate(() => { const g = window.game(); g.magnetTicks = 600; g.springTicks = 600; g.doubleTicks = 600; g.shieldTicks = 1800; });
await p.keyboard.press("ArrowUp");
await p.waitForTimeout(350);
await p.screenshot({ path: `${out}/v4-powers.png` });
const st = () => p.evaluate(() => { const g = window.game(); return { tick: g.tick, level: g.options.level, heat: +g.heat.toFixed(2), dead: g.dead, cause: g.deathCause, stumbles: g.stumbleCount, chaser: g.chaserTicks, shield: g.shieldTicks, coins: g.coins, overlay: !document.getElementById("overlay").hidden }; });
console.log("powers", JSON.stringify(await st()));
await p.evaluate(() => { const g = window.game(); g.shieldTicks = 0; g.magnetTicks = 0; g.springTicks = 0; g.doubleTicks = 0; });
let ghost = false, caught = false, s;
for (let i = 0; i < 500; i++) {
  await p.waitForTimeout(80);
  s = await st();
  if (!ghost && s.chaser > 220) { await p.screenshot({ path: `${out}/v4-ghost.png` }); console.log("ghost", JSON.stringify(s)); ghost = true; }
  if (s.dead && !caught) { await p.waitForTimeout(900); await p.screenshot({ path: `${out}/v4-caught.png` }); console.log("caught", JSON.stringify(await st())); caught = true; }
  if (s.dead && s.overlay) break;
}
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/v4-card.png` });
console.log("end", JSON.stringify(await st()), "errors:", errs.length ? errs : "none");
await b.close();
