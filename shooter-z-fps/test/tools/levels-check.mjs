// The two AI levels (Easy = model 28M, Hard = model 34M), in a real browser:
//   - menu: Easy / Hard shown, desktop starts on Hard, phones on Easy; the selected level's model loads first
//   - Watch AI vs AI (34M vs 28M) meets and fights on both maps; the menu backdrop mixes both models
//   - a 1v1 on each level (scripted aim, like ai-check), 2v2 Hard (your teammate 28M, opponents 34M),
//     1 vs 3 Hard (2x 34M + 1x 28M)
//   - fps, inference time per decision, no console errors
// Usage: node test/tools/levels-check.mjs [base-url] [watch seconds per map]   (dev server running)
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://localhost:5190";
const watchSecs = Number(process.argv[3] ?? 60);
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const errs = [];
let failed = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? ` (${typeof info === "string" ? info : JSON.stringify(info)})` : ""}`); if (!ok) failed++; };
const size = { width: 1600, height: 900 };

async function page(ctxOpts = { viewport: size }) {
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  const models = [];
  p.on("request", (r) => { const m = r.url().match(/shooter-ai-(\w+)\.onnx/); if (m) models.push(m[1]); });
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  return { ctx, p, models };
}
const aiModels = (p) => p.evaluate(() => window.shooterZ.ai?.models ?? null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- menu (desktop): Hard by default, its model first, then the backdrop gets both
{
  const { ctx, p, models } = await page();
  await p.goto(`${base}/?autotest&fps`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 60000 });
  const menu = await p.evaluate(() => ({
    shown: !document.getElementById("aiLevelField").hidden,
    on: document.querySelector("[data-setting=aiLevel] .on")?.textContent,
    labels: [...document.querySelectorAll("[data-setting=aiLevel] button")].map((x) => x.textContent),
    wording: /trained ai/i.test(document.body.innerText),
  }));
  check("desktop menu: Easy / Hard, starts on Hard, no 'Trained AI' wording", menu.shown && menu.on === "Hard" && same(menu.labels, ["Easy", "Hard"]) && !menu.wording, menu);
  check("desktop: the Hard model loads first", models[0] === "34m", models);
  await p.waitForFunction(() => new Set(Object.values(window.shooterZ.ai?.models ?? {})).size === 2, null, { timeout: 60000 }).catch(() => {});
  check("menu backdrop: 34M and 28M robots (free-for-all, alternating)", same(await aiModels(p), { 0: "34m", 1: "28m", 2: "34m", 3: "28m" }), await aiModels(p));
  await ctx.close();
}

// ---- phone: Easy by default, its model first
{
  const { ctx, p, models } = await page({ ...devices["iPhone 13 landscape"] });
  await p.goto(`${base}/?nofs`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90000 });
  const on = await p.evaluate(() => document.querySelector("[data-setting=aiLevel] .on")?.textContent);
  check("phone: starts on Easy, and the Easy model loads first", on === "Easy" && models[0] === "28m", { on, models });
  await ctx.close();
}

// ---- Watch AI vs AI (1v1): 34M vs 28M meet and fight on both maps
for (const map of ["base", "ship"]) {
  const { ctx, p } = await page();
  await p.goto(`${base}/?autotest&fps&seed=11`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 60000 });
  await p.click("[data-setting=mode] [data-v=duel]");
  await p.click(`[data-setting=map] [data-v=${map}]`);
  await p.click("#watch");
  await p.waitForFunction(() => window.shooterZ?.state === "watch" && window.shooterZ.ai, null, { timeout: 60000 });
  const m = await aiModels(p);
  await p.waitForTimeout(watchSecs * 1000);
  const r = await p.evaluate(() => { const z = window.shooterZ, g = z.match.game; return { shots: g.agents.reduce((s, a) => s + a.shots, 0), kills: g.agents.reduce((s, a) => s + a.kills, 0), fps: document.querySelector(".fps")?.textContent ?? "", aiMs: z.ai.avgMs().toFixed(2) }; });
  check(`watch ${map}: 34M vs 28M`, same(m, { 0: "34m", 1: "28m" }), m);
  check(`watch ${map}: they fight (${watchSecs} s)`, r.kills >= 1 && r.shots >= 10, r);
  await ctx.close();
}

// ---- play: scripted aim at the nearest visible enemy (mouse path), W when nothing is in sight
async function play({ level, mode, secs, expect, seed = 12 }) {
  const { ctx, p } = await page();
  await p.goto(`${base}/?autotest&fps&seed=${seed}`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 60000 });
  await p.click(`[data-setting=aiLevel] [data-v=${level}]`);
  await p.click(`[data-setting=mode] [data-v=${mode}]`);
  await p.click("[data-setting=map] [data-v=base]");
  await p.click("#play");
  await p.waitForFunction(() => window.shooterZ?.state === "play" && window.shooterZ.ai, null, { timeout: 60000 });
  const m = await aiModels(p);
  await p.mouse.move(800, 450);
  const s0 = Date.now();
  let r = {};
  while (Date.now() - s0 < secs * 1000) {
    r = await p.evaluate(() => {
      const z = window.shooterZ, g = z.match.game, me = g.agents[0];
      const eye = me.y + (me.crouch ? 1.1 : 1.62);
      const w = (v) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));
      let best = null, bd = 1e9;
      for (const t of g.agents) {
        if (t === me || !t.alive || !me.alive || t.team === me.team) continue;
        const d = Math.hypot(t.x - me.x, t.z - me.z);
        if (d < bd && g.world.clear(me.x, eye, me.z, t.x, t.y + 1.15, t.z)) { best = t; bd = d; }
      }
      let fire = false;
      if (best) {
        const dx = best.x - me.x, dz = best.z - me.z;
        const ey = w(Math.atan2(-dx, -dz) - me.yaw), ep = Math.atan2(best.y + 1.15 - eye, bd) - me.pitch, s = z.input.sensitivity;
        z.input.addMouse((-ey * 0.5) / s, (-ep * 0.5) / s);
        fire = Math.abs(ey) < 0.05 && Math.abs(ep) < 0.05;
      }
      const others = g.agents.slice(1);
      return { clear: !!best, fire, myKills: me.kills, myDeaths: me.deaths, aiShots: others.reduce((s, a) => s + a.shots, 0), aiHits: others.reduce((s, a) => s + a.hits, 0), aiKills: others.reduce((s, a) => s + a.kills, 0), fps: document.querySelector(".fps")?.textContent ?? "", aiMs: z.ai.avgMs().toFixed(2) };
    });
    if (r.fire) await p.mouse.down(); else await p.mouse.up();
    if (!r.clear) await p.keyboard.down("KeyW"); else await p.keyboard.up("KeyW");
    await p.waitForTimeout(60);
  }
  delete r.clear; delete r.fire;
  check(`${mode} on ${level}: models`, same(m, expect), m);
  check(`${mode} on ${level}: the AI fights (${secs} s)`, r.aiShots >= 10 && r.aiHits >= 3, r);
  await ctx.close();
  return r;
}
await play({ level: "easy", mode: "duel", secs: 45, expect: { 1: "28m" } });
await play({ level: "hard", mode: "duel", secs: 45, expect: { 1: "34m" } });
await play({ level: "hard", mode: "team", secs: 60, expect: { 1: "28m", 2: "34m", 3: "34m" } });
await play({ level: "hard", mode: "ffa", secs: 45, expect: { 1: "34m", 2: "34m", 3: "28m" } });

await b.close();
check("no console errors", errs.length === 0, errs.slice(0, 5).join(" | "));
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
