// Audio unlock in WebKit (Safari's engine), phone size: first tap -> music; recovery after suspend.
import { webkit, devices } from "playwright";
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices["iPhone 13"] });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5180/");
await p.waitForTimeout(2500);
const st = () => p.evaluate(() => ({ state: window.sfx.state, music: window.sfx["musicStarted"] }));
const before = await st();
const t0 = Date.now();
await p.tap("#play");
let firstMusicMs = null;
for (let i = 0; i < 50 && firstMusicMs === null; i++) { await p.waitForTimeout(100); const s = await st(); if (s.state === "running" && s.music) firstMusicMs = Date.now() - t0; }
const afterTap = await st();
// simulate an interruption (screen lock / call): the context gets suspended
await p.evaluate(() => window.sfx["ctx"].suspend());
await p.waitForTimeout(300);
const suspended = await st();
// coming back: a tab switch back fires visibilitychange; then a tap
await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await p.waitForTimeout(300);
const afterVisible = await st();
await p.evaluate(() => window.sfx["ctx"].suspend());
await p.touchscreen.tap(200, 500);
await p.waitForTimeout(300);
const afterTap2 = await st();
console.log(JSON.stringify({ before, firstMusicMs, afterTap, suspended, afterVisible, afterTap2 }), "errors:", errs.length ? errs : "none");
await b.close();
