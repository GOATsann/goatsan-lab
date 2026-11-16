// Save score + sign-in hand-off + leaderboard against a mocked API (the real one is on the personal site).
import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
let signedIn = false, posted = [], signinUrl = null;
await p.route("http://localhost:3100/**", async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === "/api/surfer/score") {
    posted.push(JSON.parse(route.request().postData()));
    if (!signedIn) return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"sign in first"}' });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ score: 321, level: 1, best: 321, rank: 4, improved: true }) });
  }
  if (u.pathname === "/api/surfer/leaderboard") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ level: Number(u.searchParams.get("level")), top: [
      { rank: 1, name: "Ike", score: 9001, seconds: 600, at: "2026-11-16" }, { rank: 2, name: "<img src=x onerror=alert(1)>", score: 500, seconds: 60, at: "2026-11-16" }], me: { best: 321, rank: 4 } }) });
  }
  if (u.pathname === "/auth/signin") { signinUrl = u.toString(); signedIn = true; const back = u.searchParams.get("return"); return route.fulfill({ status: 302, headers: { location: back } }); }
  return route.fulfill({ status: 404, body: "" });
});
await p.goto("http://localhost:5180/?seed=7");
await p.waitForTimeout(2500);
await p.fill("#name", "");
await p.click("#play");
await p.evaluate(() => { const g = window.game(); g.dead = true; g.deathCause = "train front"; });
for (let i = 0; i < 40; i++) { await p.waitForTimeout(100); if (!(await p.evaluate(() => document.getElementById("overlay").hidden))) break; }
await p.waitForTimeout(300);
const saveVisible = await p.isVisible("#save");
await p.click("#save");
const emptyName = await p.textContent("#saveMsg");
await p.fill("#name", "Tester");
await p.click("#save");
await p.waitForURL("**/?**", { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(3000);
const toast = await p.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? null : t.textContent; });
const urlAfter = p.url();
const pendingLeft = await p.evaluate(() => localStorage.getItem("lights-out:pending-score"));
// leaderboard
await p.click("#boardBtn");
await p.waitForTimeout(800);
const board = await p.evaluate(() => ({ rows: [...document.querySelectorAll("#boardList li")].map((l) => l.textContent), injected: !!document.querySelector("#boardList img"), me: document.getElementById("boardMe").textContent }));
await p.screenshot({ path: "/private/tmp/claude-501/builds/board.png" });
console.log(JSON.stringify({ saveVisible, emptyName, posts: posted.map((x) => ({ name: x.name, v: x.replay.version, level: x.replay.options.level, ticks: x.replay.endTick })), signinUrl, urlAfter, toast, pendingLeft, board }), "errors:", errs.length ? errs : "none");
await b.close();
