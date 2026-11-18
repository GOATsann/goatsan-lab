// Regression test for three phone bugs, with real tap events on a phone profile:
//   1. after a match ends, Menu and Play again work by tap
//   2. the pause menu's Leave match works by tap
//   3. turning the phone upright mid-match pauses at once (no ticks run), shows "Rotate your phone to play",
//      and landscape brings back Resume; the page going to the background pauses too
// Runs WebKit with an iPhone profile (Safari and Chrome on iPhone are both WebKit; WebKit has no Pointer Lock
// API, which was the cause of bugs 1 and 2) and Chromium with an Android profile.
// Usage: node test/tools/mobile-bugs-check.mjs [base-url]   (default http://localhost:5190; dev server running)
import { chromium, webkit, devices } from "playwright";

const base = process.argv[2] ?? "http://localhost:5190";
const runs = [["webkit", webkit, "iPhone 13 landscape"], ["chromium", chromium, "Pixel 7 landscape"]];
let failed = 0;
const check = (engine, name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${engine}: ${name}${info ? ` (${info})` : ""}`);
  if (!ok) failed++;
};

for (const [engine, type, deviceName] of runs) {
  const browser = await type.launch();
  const dev = devices[deviceName];
  const ctx = await browser.newContext({ ...dev });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const st = () => p.evaluate(() => window.shooterZ.state);
  const tick = () => p.evaluate(() => window.shooterZ.match.game.tick);
  const shown = (id) => p.evaluate((i) => !document.getElementById(i).hidden, id);
  const touchOff = () => p.evaluate(() => { const t = document.querySelector(".touch"); return !t || getComputedStyle(t).display === "none"; });
  const startPlay = async () => {
    await p.tap("#playTouch");
    await p.waitForFunction(() => window.shooterZ?.state === "play" && window.shooterZ.match.game.tick > 30, null, { timeout: 30000 });
  };

  await p.goto(`${base}/?nofs`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90000 });

  // 2. pause, then Leave match
  await startPlay();
  await p.tap(".t-pause");
  await p.waitForTimeout(250);
  check(engine, "pause menu shows and the touch controls step aside", (await shown("pause")) && (await touchOff()));
  await p.tap("#quit");
  await p.waitForTimeout(400);
  check(engine, "Leave match returns to the menu", (await st()) === "menu", await st());

  // 1. match ends: Play again, then Menu
  await startPlay();
  const endMatch = () => p.evaluate(() => { const g = window.shooterZ.match.game; g.over = true; g.winnerTeam = 1; });
  await endMatch();
  await p.waitForTimeout(400);
  check(engine, "end screen shows with the touch controls gone", (await shown("touchEnd")) && (await touchOff()));
  await p.tap("#againBtn");
  await p.waitForFunction(() => window.shooterZ?.state === "play" && !window.shooterZ.match.game.over && window.shooterZ.match.game.tick > 30, null, { timeout: 30000 }).catch(() => {});
  check(engine, "Play again starts a new match", (await st()) === "play" && !(await p.evaluate(() => window.shooterZ.match.game.over)));
  await endMatch();
  await p.waitForTimeout(400);
  await p.tap("#menuBtn");
  await p.waitForTimeout(400);
  check(engine, "Menu after the match returns to the menu", (await st()) === "menu", await st());

  // 3. rotation mid-match
  await startPlay();
  const land = dev.viewport;
  await p.setViewportSize({ width: land.height, height: land.width });
  await p.waitForTimeout(300);
  const t0 = await tick();
  await p.waitForTimeout(700);
  const t1 = await tick();
  check(engine, "upright: paused at once, no ticks run", t1 === t0, `${t0} -> ${t1}`);
  check(engine, "upright: Rotate your phone to play shows", (await shown("rotatePause")) && !(await shown("pause")) && (await touchOff()));
  await p.setViewportSize(land);
  await p.waitForTimeout(300);
  check(engine, "landscape again: Resume shows", (await shown("pause")) && !(await shown("rotatePause")));
  const canvas = await p.evaluate(() => { const c = document.getElementById("view"); return [c.clientWidth, c.clientHeight, innerWidth, innerHeight]; });
  check(engine, "canvas follows the new size", canvas[0] === canvas[2] && canvas[1] === canvas[3], canvas.join(","));
  await p.tap("#resume");
  await p.waitForTimeout(500);
  const t2 = await tick();
  check(engine, "Resume plays on", t2 > t1 && !(await shown("pause")) && !(await touchOff()), `${t1} -> ${t2}`);

  // 3b. page goes to the background
  await p.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await p.waitForTimeout(200);
  const v0 = await tick();
  await p.waitForTimeout(600);
  check(engine, "background: paused", (await tick()) === v0 && (await shown("pause")));
  await p.evaluate(() => { delete document.hidden; });

  check(engine, "no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
