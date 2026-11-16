// The trained AI in Race the AI, at each level: it loads, plays, and survives. node test/tools/race-ai.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const level of [0, 1, 2]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto("http://localhost:5180/");
  await p.evaluate((l) => { localStorage.setItem("lights-out:level", String(l)); localStorage.setItem("lights-out:name", "Test"); }, level);
  await p.goto("http://localhost:5180/race.html?seed=4242");
  await p.waitForTimeout(3200);
  const st = () => p.evaluate(() => { const r = window.race(); return { phase: r.phase, driver: r.driver, clock: r.ai.tick, ai: { score: r.ai.score, m: r.ai.meters, dead: r.ai.dead, cause: r.ai.deathCause, stumbles: r.ai.stumbleCount }, you: { dead: r.you.dead } }; });
  await p.waitForTimeout(25000);
  const s = await st();
  console.log(["easy", "normal", "hard"][level], JSON.stringify(s), "errors:", errs.length ? errs : "none");
  await p.screenshot({ path: `${out}/race-ai-${level}.png` });
  await p.close();
}
await b.close();
