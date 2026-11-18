// Rigged characters in the real game page (headless Chromium): the character-select preview for each of the
// four, a 1v1 in first person, a 2v2 watched from the follow camera; checks the models are the rigged ones
// (not the stand-ins), measures frames per second, and fails on console errors. Screenshots go to <outdir>.
//   node test/tools/characters-check.mjs <outdir>
// The dev server must be running (npm run dev, port 5190) with the models in public/characters/.
import { chromium } from "playwright";

const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const result = {};

// frames per second over `ms` (requestAnimationFrame count) and the worst frame time
const fps = (ms) => p.evaluate((ms) => new Promise((res) => {
  let n = 0, worst = 0, last = performance.now();
  const t0 = last;
  const f = (now) => {
    worst = Math.max(worst, now - last); last = now; n++;
    if (now - t0 < ms) requestAnimationFrame(f); else res({ fps: +(1000 * n / (now - t0)).toFixed(1), worstMs: +worst.toFixed(1) });
  };
  requestAnimationFrame(f);
}), ms);
const rigged = () => p.evaluate(() => window.shooterZ.view.robots.map((r) => r.constructor.name));

await p.goto("http://localhost:5190/?autotest&seed=4");
await p.waitForTimeout(3000);
// character select: each preview
for (const c of [0, 1, 2, 3]) {
  await p.click(`#chars [data-c="${c}"]`);
  await p.waitForTimeout(c === 0 ? 2500 : 1800); // the Special Move plays 1.5 s after a pick
  await p.locator("#charPreview").screenshot({ path: `${out}/preview-${c}.png` }).catch(() => p.screenshot({ path: `${out}/preview-${c}.png` }));
}
result.menuBackdrop = await rigged();

// 1v1, first person (Dash)
await p.click(`#chars [data-c="0"]`);
await p.click("[data-setting=mode] [data-v=duel]");
await p.click("[data-setting=skill] [data-v=normal]");
await p.click("#play");
await p.waitForTimeout(1500);
result.duelModels = await rigged();
await p.keyboard.down("KeyW");
await p.waitForTimeout(800);
await p.keyboard.up("KeyW");
result.duelFps = await fps(5000);
await p.screenshot({ path: `${out}/duel-fp.png` });
// look at the opponent from its follow camera through the debug hook (third person)
await p.evaluate(() => { const z = window.shooterZ; z.rig.mode = "follow"; z.rig.target = 1; });
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/duel-follow-bot.png` });
await p.evaluate(() => { window.shooterZ.rig.mode = "fp"; });

// 2v2, watched (spectator follow camera), on the ship
await p.goto("http://localhost:5190/?autotest&seed=9");
await p.waitForTimeout(2500);
await p.click("[data-setting=mode] [data-v=team]");
await p.click("[data-setting=map] [data-v=ship]");
await p.click("#watch");
await p.waitForTimeout(4000);
result.teamModels = await rigged();
result.teamFps = await fps(5000);
await p.screenshot({ path: `${out}/team-follow.png` });
await p.waitForTimeout(6000);
await p.screenshot({ path: `${out}/team-follow-2.png` });
await p.evaluate(() => { window.shooterZ.rig.mode = "overview"; });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/team-overview.png` });

console.log(JSON.stringify({ ...result, errors: errs.length ? errs : "none" }));
await b.close();
