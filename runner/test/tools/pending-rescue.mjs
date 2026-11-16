// A waiting run saves on a plain page load (lost redirect); signed out it waits quietly with a Sign in button.
import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
let signedIn = false;
await p.route("http://localhost:3100/**", (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === "/api/surfer/score") return signedIn
    ? route.fulfill({ status: 200, contentType: "application/json", body: '{"score":50,"level":1,"best":50,"rank":1,"improved":true}' })
    : route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Sign in to save your score."}' });
  return route.fulfill({ status: 404, body: "" });
});
await p.goto("http://localhost:5180/");
await p.evaluate(() => localStorage.setItem("lights-out:pending-score", JSON.stringify({ name: "Tester", replay: { version: 4 }, at: Date.now() })));
await p.reload(); await p.waitForTimeout(2500);
const signedOut = await p.evaluate(() => ({ url: location.href, toast: document.getElementById("toast").textContent, button: !!document.querySelector(".toast-btn"), kept: !!localStorage.getItem("lights-out:pending-score") }));
signedIn = true;
await p.goto("http://localhost:5180/"); await p.waitForTimeout(2500);
const after = await p.evaluate(() => ({ toast: document.getElementById("toast").textContent, kept: !!localStorage.getItem("lights-out:pending-score") }));
await p.evaluate(() => localStorage.setItem("lights-out:pending-score", JSON.stringify({ name: "Old", replay: {}, at: Date.now() - 25 * 3600e3 })));
await p.reload(); await p.waitForTimeout(1500);
const old = await p.evaluate(() => ({ toastHidden: document.getElementById("toast").hidden, kept: !!localStorage.getItem("lights-out:pending-score") }));
console.log(JSON.stringify({ signedOut, after, old }), "errors:", errs.length ? errs : "none");
await b.close();
