// Desktop Chrome + WebKit: audio unlock/recovery (first click, tab switch, sleep) and Watch the AI.
import { chromium, webkit } from "playwright";
for (const [name, engine, opts] of [["chrome", chromium, { channel: "chrome" }], ["webkit", webkit, {}]]) {
  const b = await engine.launch(opts);
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:5180/");
  await p.waitForTimeout(2500);
  const st = () => p.evaluate(() => ({ state: window.sfx.state, music: window.sfx["musicStarted"] }));
  const t0 = Date.now();
  await p.click("#play");
  let ms = null;
  for (let i = 0; i < 50 && ms === null; i++) { await p.waitForTimeout(100); const s = await st(); if (s.state === "running" && s.music) ms = Date.now() - t0; }
  // tab switch: the tab is hidden, the browser suspends audio, the tab comes back
  await p.evaluate(() => window.sfx["ctx"].suspend());
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForTimeout(300);
  const tab = (await st()).state;
  // laptop sleep: audio suspended or interrupted; on wake the window gets focus
  await p.evaluate(() => window.sfx["ctx"].suspend());
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForTimeout(300);
  const wake = (await st()).state;
  // Watch the AI from the start screen
  await p.evaluate(() => { const g = window.game(); g.dead = true; g.deathCause = "train front"; });
  await p.waitForTimeout(2500);
  await p.click("#watch");
  await p.waitForURL("**/watch.html**");
  await p.waitForTimeout(4000);
  const w = await p.evaluate(() => { const w = window.watch(); return { url: location.search, driver: w.driver, tick: w.game.tick }; });
  await p.click("#hide");
  const hidden = await p.evaluate(() => document.getElementById("panel").hidden);
  await p.mouse.click(640, 400);
  const shown = await p.evaluate(() => !document.getElementById("panel").hidden);
  await p.click("text=Back");
  await p.waitForURL((u) => u.pathname === "/");
  console.log(name, JSON.stringify({ firstClickToMusicMs: ms, afterTabSwitch: tab, afterWake: wake, watch: w, hideWorks: hidden, tapShows: shown, backHome: true }), "errors:", errs.length ? errs : "none");
  await b.close();
}
