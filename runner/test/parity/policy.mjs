// Browser policy parity in Chromium, Firefox and WebKit:  node test/parity/policy.mjs <run>   (dev server running)
import { chromium, firefox, webkit } from "playwright";
const run = process.argv[2];
let failed = false;
for (const engine of [chromium, firefox, webkit]) {
  const b = await engine.launch();
  const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://localhost:5180/test/parity/policy.html?run=${run}`);
  const r = await p.waitForFunction(() => window.parity, null, { timeout: 120000 }).then((h) => h.jsonValue()).catch((e) => ({ error: e.message, errs }));
  console.log(engine.name().padEnd(9), JSON.stringify(r));
  failed ||= !r.n || r.bad.length > 0;
  await b.close();
}
process.exit(failed ? 1 : 0);
