// Race the AI on a phone (stacked) and a desktop (side by side). node test/tools/race.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [name, vp] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 720 }]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: name === "phone" ? 2 : 1 });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto("http://localhost:5180/?seed=7");
  await p.waitForTimeout(2500);
  await p.fill("#name", "Ike");
  await p.click("#race");
  await p.waitForURL("**/race.html");
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/race-${name}-count.png` });
  await p.waitForTimeout(2500);
  const st = () => p.evaluate(() => { const r = window.race(); return { phase: r.phase, driver: r.driver, you: { tick: r.you.tick, score: r.you.score, dead: r.you.dead }, ai: { tick: r.ai.tick, score: r.ai.score, dead: r.ai.dead, cause: r.ai.deathCause }, overlay: !document.getElementById("overlay").hidden, title: document.getElementById("title").textContent }; });
  await p.keyboard.press("ArrowLeft");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/race-${name}-mid.png` });
  console.log(name, "mid", JSON.stringify(await st()));
  for (let i = 0; i < 600; i++) { await p.waitForTimeout(100); const s = await st(); if (s.overlay) break; }
  await p.screenshot({ path: `${out}/race-${name}-end.png` });
  console.log(name, "end", JSON.stringify(await st()), "errors:", errs.length ? errs : "none");
  await p.close();
}
await b.close();
