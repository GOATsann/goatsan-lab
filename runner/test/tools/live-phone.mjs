// Live phone check: node test/tools/live-phone.mjs <ip-or-empty> <outdir>   (ip: test before DNS points at CloudFront)
import { chromium, devices } from "playwright";
const [ip, out] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", args: ip ? [`--host-resolver-rules=MAP surfer.theonlygoatsan.com ${ip}`] : [] });
const ctx = await b.newContext({ ...devices["iPhone 13"], hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const t0 = Date.now();
await p.goto("https://surfer.theonlygoatsan.com/", { waitUntil: "load" });
const loadMs = Date.now() - t0;
await p.waitForFunction(() => typeof window.game === "function");
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/live-start.png` });
await p.tap("#play");
await p.waitForTimeout(800);
const swipe = async (dx, dy) => {
  const box = await p.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x = box.w / 2, y = box.h * 0.6;
  await p.touchscreen.tap(x, y).catch(() => {});
  await p.evaluate(([x, y, dx, dy]) => {
    const c = document.querySelector("canvas");
    const ev = (type, cx, cy) => c.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, pointerType: "touch", bubbles: true }));
    ev("pointerdown", x, y); ev("pointerup", x + dx, y + dy);
  }, [x, y, dx, dy]);
};
const lane0 = await p.evaluate(() => window.game().lane);
await swipe(-120, 0); await p.waitForTimeout(400);
const lane1 = await p.evaluate(() => window.game().lane);
await swipe(0, -120); await p.waitForTimeout(150);
const air = await p.evaluate(() => !window.game().grounded);
const sound = await p.evaluate(() => ({ ctx: window.sfx["ctx"]?.state, music: window.sfx["musicStarted"], played: window.sfx.played }));
await p.screenshot({ path: `${out}/live-play.png` });
// race with the trained AI
await p.goto("https://surfer.theonlygoatsan.com/race.html");
await p.waitForTimeout(6000);
const race = await p.evaluate(() => { const r = window.race(); return { phase: r.phase, driver: r.driver, aiTicks: r.ai.tick, aiDead: r.ai.dead }; });
await p.screenshot({ path: `${out}/live-race.png` });
console.log(JSON.stringify({ loadMs, swipeLeft: `${lane0} -> ${lane1}`, swipeUpJump: air, sound, race }), "errors:", errs.length ? errs : "none");
await b.close();
