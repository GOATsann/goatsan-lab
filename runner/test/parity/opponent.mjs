// Browser opponent vs bench-opponent.ts, in Chromium, Firefox and WebKit:  node test/parity/opponent.mjs
import { chromium, firefox, webkit } from "playwright";
let failed = false;
for (const engine of [chromium, firefox, webkit]) {
  const b = await engine.launch();
  const p = await b.newPage();
  await p.goto("http://localhost:5180/test/parity/opponent.html");
  const r = await p.waitForFunction(() => window.parity, null, { timeout: 300000 }).then((h) => h.jsonValue());
  const bad = r.results.filter((x) => !x.match);
  console.log(engine.name().padEnd(9), r.driver, `${r.results.length - bad.length}/${r.results.length} identical`, bad.length ? JSON.stringify(bad) : "");
  failed ||= bad.length > 0;
  await b.close();
}
process.exit(failed ? 1 : 0);
