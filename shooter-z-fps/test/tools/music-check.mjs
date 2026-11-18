// Background music: starts on the first interaction, loops (silence trimmed), full on the menu, ducked
// in a match, dipped further while firing, the Music toggle and M mute work. Logs the gain values.
//   node test/tools/music-check.mjs [base url]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:5190";
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(`${base}/?autotest`);
await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90000 });
const level = () => p.evaluate(() => Number(window.shooterZ.sfx.musicLevel().toFixed(3)));
const log = {};
log.beforeInteraction = await p.evaluate(() => window.shooterZ.sfx.musicInfo());
await p.mouse.click(200, 860); // first interaction anywhere
await p.waitForTimeout(3500);
log.loop = await p.evaluate(() => window.shooterZ.sfx.musicInfo());
log.menu = await level();
await p.click("[data-setting=mode] [data-v=duel]");
await p.click("#play");
await p.waitForFunction(() => window.shooterZ?.state === "play", null, { timeout: 30000 });
await p.waitForTimeout(3500);
log.play = await level();
await p.mouse.down(); await p.waitForTimeout(250);
log.firing = await level();
await p.mouse.up(); await p.waitForTimeout(2500);
log.afterFiring = await level();
await p.keyboard.press("KeyM"); await p.waitForTimeout(200);
log.mMutesAll = await p.evaluate(() => ({ muted: window.shooterZ.sfx.muted }));
await p.keyboard.press("KeyM");
await p.keyboard.press("Escape");
await p.evaluate(() => document.getElementById("quit").click());
await p.waitForTimeout(3500);
log.backOnMenu = await level();
await p.click("[data-setting=music] [data-v=off]"); await p.waitForTimeout(2000);
log.musicOff = await level();
log.storedOff = await p.evaluate(() => localStorage.getItem("shooter-z:music"));
await p.click("[data-setting=music] [data-v=on]"); await p.waitForTimeout(2500);
log.musicOnAgain = await level();
console.log(JSON.stringify({ ...log, errors: errs.length ? errs : "none" }, null, 1));
await b.close();
