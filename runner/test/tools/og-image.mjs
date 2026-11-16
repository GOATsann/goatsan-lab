// Make the share image (public/og.png, 1200x630) from a real game moment + the title, and the
// home-screen icon (public/apple-touch-icon.png, 180x180) from the favicon. Needs the dev server.
//   node test/tools/og-image.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const replay = JSON.parse(readFileSync(new URL("./og-run.json", import.meta.url), "utf8"));
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto("http://localhost:5180/replay.html?clean");
await p.waitForFunction(() => "replayApi" in window);
await p.evaluate(() => window.replayApi.character("girl"));
await p.evaluate((r) => window.replayApi.load(r, ""), replay);
for (let t = 0; t < 1680; t += 6) await p.evaluate(() => window.replayApi.frame(6)); // ~28 s in: trains, coins, a ramp
await p.addStyleTag({ content: `
  .hud, .boosters, .chaser, .danger, .audioctl { display: none !important; }
  .og { position: fixed; inset: 0; display: grid; align-content: start; padding: 64px 0 0 110px;
    background: linear-gradient(180deg, rgba(6,8,28,0.9) 0%, rgba(6,8,28,0.6) 48%, rgba(6,8,28,0) 66%);
    font-family: system-ui, -apple-system, sans-serif; color: #fff; }
  .og h1 { margin: 0; font-size: 86px; line-height: 0.95; font-weight: 900; letter-spacing: -1.5px; text-shadow: 0 4px 30px rgba(0,0,0,0.5); }
  .og h1 span { color: #22e3f0; }
  .og p { margin: 22px 0 0; font-size: 36px; font-weight: 700; color: #ffd36a; }
  .og small { margin-top: 14px; font-size: 24px; color: #dfe4f7; font-weight: 500; }` });
await p.evaluate(() => {
  const d = document.createElement("div");
  d.className = "og";
  d.innerHTML = "<h1>Lights-Out <span>Surfer</span></h1><p>Race the AI that taught itself to play.</p><small>Free in your browser · surfer.theonlygoatsan.com</small>";
  document.body.appendChild(d);
});
await p.waitForTimeout(300);
await p.screenshot({ path: "public/og.png" });
const icon = await b.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(`<body style="margin:0;background:#1a2350">${readFileSync("public/favicon.svg", "utf8").replace("<svg ", '<svg width="180" height="180" ')}</body>`);
await icon.screenshot({ path: "public/apple-touch-icon.png" });
await b.close();
console.log("wrote public/og.png and public/apple-touch-icon.png");
