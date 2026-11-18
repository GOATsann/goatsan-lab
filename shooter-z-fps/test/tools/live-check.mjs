// Check a deployed Shooter Z (or any base URL): headers, desktop play + Watch AI vs AI, phone touch play.
//   node test/tools/live-check.mjs <base url> <screenshot dir>
import { chromium } from "playwright";

const [base, out] = process.argv.slice(2);
const report = { headers: {} };
const errs = [];

// ---- 1. content types and caching of every kind of file
const html = await (await fetch(`${base}/`)).text();
const assetJs = html.match(/assets\/main-[^"]+\.js/)?.[0];
const files = ["/", `/${assetJs}`, "/models/shooter-ai-28m.onnx", "/models/shooter-ai-28m.json", "/models/shooter-ai-34m.onnx", "/models/shooter-ai-34m.json", "/characters/dash.glb", "/characters/characters.json", "/sfx/echo.mp3"];
for (const f of files) {
  const r = await fetch(`${base}${f}`, { method: "HEAD" });
  report.headers[f.replace(/main-[^.]+\./, "main-*.")] = { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), size: r.headers.get("content-length") };
}
// the onnxruntime wasm is loaded by the script; find its hashed name in the bundle
const js = await (await fetch(`${base}/${assetJs}`)).text();
const ortJs = (js.match(/assets\/ort\.wasm\.bundle[^"']+\.js/) ?? [])[0];
let wasmName = null;
if (ortJs) wasmName = ((await (await fetch(`${base}/${ortJs}`)).text()).match(/ort-wasm[^"'`]+\.wasm/) ?? [])[0] ?? null;
if (!wasmName) wasmName = (js.match(/ort-wasm[^"'`]+\.wasm/) ?? [])[0] ?? null;
if (wasmName) {
  const r = await fetch(`${base}/assets/${wasmName.replace(/^.*\//, "")}`, { method: "HEAD" });
  report.headers["/assets/ort-wasm-*.wasm"] = { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), size: r.headers.get("content-length") };
}

const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const watchErrors = (p, tag) => { p.on("pageerror", (e) => errs.push(`${tag}: ${e.message}`)); p.on("console", (m) => m.type() === "error" && errs.push(`${tag}: ${m.text()}`)); };

// ---- 2. desktop: menu, the AI loads, a 1v1, then Watch AI vs AI
{
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  watchErrors(p, "desktop");
  const t0 = Date.now();
  await p.goto(`${base}/?autotest&fps`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90000 });
  report.desktop = { aiLoadedAfterS: ((Date.now() - t0) / 1000).toFixed(1) };
  await p.screenshot({ path: `${out}/live-menu.png` });
  await p.click("[data-setting=mode] [data-v=duel]");
  await p.click("#play");
  await p.waitForFunction(() => window.shooterZ?.state === "play" && window.shooterZ.ai, null, { timeout: 30000 });
  await p.mouse.move(800, 450);
  const s0 = Date.now();
  let r = {};
  while (Date.now() - s0 < 30000) {
    r = await p.evaluate(() => {
      const z = window.shooterZ, g = z.match.game, me = g.agents[0], t = g.agents[1];
      const eye = me.y + 1.62, dx = t.x - me.x, dz = t.z - me.z, d = Math.hypot(dx, dz);
      const clear = t.alive && me.alive && g.world.clear(me.x, eye, me.z, t.x, t.y + 1.15, t.z);
      const w = (v) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));
      let fire = false;
      if (clear) { const ey = w(Math.atan2(-dx, -dz) - me.yaw), ep = Math.atan2(t.y + 1.15 - eye, d) - me.pitch, s = z.input.sensitivity; z.input.addMouse((-ey * 0.5) / s, (-ep * 0.5) / s); fire = Math.abs(ey) < 0.05 && Math.abs(ep) < 0.05; }
      return { clear, fire, myHits: me.hits, aiShots: t.shots, aiHits: t.hits, kills: me.kills + t.kills, fps: document.querySelector(".fps")?.textContent ?? "", aiMs: z.ai.avgMs().toFixed(2) };
    });
    if (r.fire) await p.mouse.down(); else await p.mouse.up();
    if (!r.clear) await p.keyboard.down("KeyW"); else await p.keyboard.up("KeyW");
    await p.waitForTimeout(60);
  }
  await p.mouse.up(); await p.keyboard.up("KeyW");
  await p.screenshot({ path: `${out}/live-1v1.png` });
  report.desktop.play1v1 = r;
  // Watch AI vs AI
  await p.goto(`${base}/?autotest&fps`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90000 });
  await p.click("[data-setting=mode] [data-v=duel]");
  await p.click("#watch");
  await p.waitForFunction(() => window.shooterZ?.state === "watch", null, { timeout: 30000 });
  await p.waitForTimeout(45000);
  report.desktop.watch = await p.evaluate(() => { const z = window.shooterZ, g = z.match.game; return { ai: !!z.ai, shots: g.agents.reduce((s, a) => s + a.shots, 0), hits: g.agents.reduce((s, a) => s + a.hits, 0), kills: g.agents.reduce((s, a) => s + a.kills, 0), fps: document.querySelector(".fps")?.textContent ?? "", aiMs: z.ai.avgMs().toFixed(2) }; });
  await p.screenshot({ path: `${out}/live-watch.png` });
  await p.close();
}

// ---- 3. phone: portrait shows the rotate prompt; landscape touch play with multi-touch
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  watchErrors(p, "phone-portrait");
  await p.goto(`${base}/`);
  await p.waitForTimeout(3000);
  report.phonePortrait = await p.evaluate(() => ({ rotate: getComputedStyle(document.querySelector(".rotate")).display !== "none", watch: getComputedStyle(document.getElementById("watchPhone")).display !== "none" }));
  await p.screenshot({ path: `${out}/live-phone-portrait.png` });
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  watchErrors(p, "phone-landscape");
  const cdp = await ctx.newCDPSession(p);
  const active = new Map();
  const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [...active.values()] });
  const down = async (id, x, y) => { active.set(id, { x, y, id }); await send("touchStart"); };
  const move = async (id, x, y) => { active.set(id, { x, y, id }); await send("touchMove"); };
  const up = async (id) => { active.delete(id); await send(active.size ? "touchMove" : "touchEnd"); };
  await p.goto(`${base}/?nofs`);
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90000 });
  await p.screenshot({ path: `${out}/live-phone-landscape-menu.png` });
  await p.tap("#playTouch");
  await p.waitForFunction(() => window.shooterZ?.state === "play" && window.shooterZ.ai, null, { timeout: 30000 });
  const g0 = await p.evaluate(() => { const a = window.shooterZ.match.game.agents[0]; return { x: a.x, z: a.z, yaw: a.yaw }; });
  await down(1, 150, 290); await move(1, 150, 232);
  await down(2, 600, 170);
  for (let i = 1; i <= 15; i++) { await move(2, 600 + i * 6, 170); await p.waitForTimeout(60); }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/live-phone-landscape-play.png` });
  const g1 = await p.evaluate(() => { const a = window.shooterZ.match.game.agents[0]; return { x: a.x, z: a.z, yaw: a.yaw, touchUi: !!document.querySelector(".touch") }; });
  await up(2); await up(1);
  report.phoneLandscape = { moved: Math.hypot(g1.x - g0.x, g1.z - g0.z).toFixed(1), turned: Math.abs(g1.yaw - g0.yaw).toFixed(2), touchUi: g1.touchUi };
  await ctx.close();
}
await b.close();
console.log(JSON.stringify({ ...report, errors: errs.length ? errs.slice(0, 8) : "none" }, null, 1));
