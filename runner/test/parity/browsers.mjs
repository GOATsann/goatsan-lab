// Determinism across engines: the reference replays (made in Node) must hash the same in
// Chromium, Firefox and WebKit. Needs the dev server: npm run dev
//   node test/parity/browsers.mjs
import { chromium, firefox, webkit } from "playwright";

const url = process.env.PARITY_URL ?? "http://localhost:5180/test/parity/check.html";
let failed = false;
for (const engine of [chromium, firefox, webkit]) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const r = await page.waitForFunction(() => window.parity, null, { timeout: 120000 }).then((h) => h.jsonValue());
  console.log(`${engine.name().padEnd(9)} ${r.checkpoints} checkpoints in ${r.cases} replays: ${r.bad.length ? "MISMATCH " + JSON.stringify(r.bad.slice(0, 3)) : "all match"}`);
  failed ||= r.bad.length > 0;
  await browser.close();
}
process.exit(failed ? 1 : 0);
