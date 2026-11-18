// Phone-size check (portrait 390x844 and landscape 844x390): menu, character select + 3D preview,
// Watch AI vs AI, the death cam (robot's-eyes view of a robot that gets eliminated) and the tutorial card.
// Reports horizontal overflow, tap targets under 44 px, text under 12 px, and console errors.
//   node test/tools/mobile-check.mjs <outdir>
import { chromium } from "playwright";

const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const report = {};
const audit = (p, scope) => p.evaluate((scope) => {
  const vw = window.innerWidth;
  const root = document.querySelector(scope) ?? document.body;
  const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const small = [...root.querySelectorAll("button, a, input")].filter(visible).map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.height < 44 || r.width < 44).map(({ e, r }) => `${e.id || e.dataset.v || e.dataset.c || e.dataset.sb || e.textContent.trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  const over = [...root.querySelectorAll("*")].filter(visible).filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; })
    .filter((e) => !e.closest("canvas#view") && e.tagName !== "CANVAS").map((e) => `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 40));
  const tiny = [...root.querySelectorAll("*")].filter(visible).filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => `${e.tagName.toLowerCase()}.${e.className} ${getComputedStyle(e).fontSize}`.slice(0, 50));
  return { pageOverflow: document.documentElement.scrollWidth > vw, smallTargets: small, offscreen: [...new Set(over)].slice(0, 8), tinyText: [...new Set(tiny)].slice(0, 8) };
}, scope);

for (const [name, vp] of [["portrait", { width: 390, height: 844 }], ["landscape", { width: 844, height: 390 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto("http://localhost:5190/?seed=6");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/mobile-${name}-menu.png` });
  const menu = await audit(p, "#menu");
  // character select + preview
  await p.locator("#chars [data-c='3']").scrollIntoViewIfNeeded();
  await p.tap("#chars [data-c='3']");
  await p.waitForTimeout(1200);
  await p.locator("#charPreview").scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/mobile-${name}-character.png` });
  const prev = await p.evaluate(() => { const r = document.getElementById("charCanvas").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), vw: innerWidth }; });
  // watch AI vs AI
  await p.locator("#watchPhone").scrollIntoViewIfNeeded();
  await p.tap("#watchPhone");
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${out}/mobile-${name}-watch.png` });
  const watch = await audit(p, ".hud");
  // death cam: look through the eyes of the next robot that gets eliminated
  await p.evaluate(() => {
    const z = window.shooterZ;
    window.__dc = null;
    const g = z.match.game;
    const orig = g.step.bind(g);
    g.step = (a) => { orig(a); for (const e of g.events) if (e.type === "kill" && window.__dc === null) { window.__dc = e.v; z.rig.mode = "pov"; z.rig.target = e.v; } };
  });
  await p.waitForFunction(() => window.__dc !== null, null, { timeout: 90000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/mobile-${name}-deathcam.png` });
  const death = await p.evaluate(() => document.querySelector(".center")?.textContent ?? "");
  await ctx.close();
  // tutorial card (the tutorial itself needs a keyboard; this checks its prompt fits a narrow screen)
  const ctx2 = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errs.push(e.message));
  await p2.goto("http://localhost:5190/?autotest&start=tutorial&seed=6");
  await p2.waitForTimeout(2500);
  await p2.screenshot({ path: `${out}/mobile-${name}-tutorial.png` });
  const tut = await audit(p2, ".hud");
  await ctx2.close();
  report[name] = { menu, preview: prev, watch, deathCamText: death, tutorial: tut, errors: errs.length ? errs : "none" };
}
console.log(JSON.stringify(report, null, 1));
await b.close();
