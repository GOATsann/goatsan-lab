// Phone-size check: the menu offers "Watch AI vs AI" and "Play it on a computer"; watching works.
//   node test/tools/phone-check.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:5190/?seed=4");
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/phone-menu.png` });
const playVisible = await p.isVisible("#play");
await p.tap("#watchPhone");
await p.waitForTimeout(6000);
await p.screenshot({ path: `${out}/phone-watch.png` });
await p.tap("[data-sb=cam]");
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/phone-watch-cam2.png` });
const st = await p.evaluate(() => ({ state: window.shooterZ.state, tick: window.shooterZ.match.tick, mode: window.shooterZ.rig.mode }));
console.log(JSON.stringify({ playVisible, ...st, errors: errs.length ? errs : "none" }));
await b.close();
