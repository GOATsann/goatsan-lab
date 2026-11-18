// Touch play check on a phone held sideways (844x390), with real multi-touch through Chrome DevTools:
// move (stick) + aim (drag) + Fire at once, Special Move, the portrait "rotate" prompt, and the tutorial
// played start to finish by touch. Optionally records the touch-play clip.
//   node test/tools/touch-check.mjs <screenshot dir> [video out .mp4]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const [out, videoOut, baseArg] = process.argv.slice(2);
const BASE = baseArg ?? "http://localhost:5190";
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const errs = [];
const L = { width: 844, height: 390 };
const vids = videoOut ? mkdtempSync(join(tmpdir(), "shooterz-touch-")) : null;

async function phonePage(vp, record = false) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: record ? 1 : 2, hasTouch: true, isMobile: true, ...(record && vids ? { recordVideo: { dir: vids, size: vp } } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const cdp = await ctx.newCDPSession(p);
  const active = new Map();
  const send = async (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [...active.values()] });
  const T = {
    async down(id, x, y) { const isNew = active.size === 0; active.set(id, { x, y, id }); await send(isNew ? "touchStart" : "touchStart"); },
    async move(id, x, y) { active.set(id, { x, y, id }); await send("touchMove"); },
    async up(id) { active.delete(id); if (active.size) await send("touchMove"); else await send("touchEnd"); },
    async tap(x, y, id = 9) { await this.down(id, x, y); await p.waitForTimeout(80); await this.up(id); },
  };
  return { ctx, p, T };
}
// button centres (from the CSS: right/bottom offsets + half size), landscape 844x390
const BTN = {
  fire: { x: 844 - 24 - 48, y: 390 - 28 - 48 },
  jump: { x: 844 - 136 - 32, y: 390 - 22 - 32 },
  crouch: { x: 844 - 214 - 32, y: 390 - 22 - 32 },
  reload: { x: 844 - 128 - 27, y: 390 - 106 - 27 },
  ability: { x: 844 - 34 - 37, y: 390 - 142 - 37 },
};
const game = (p) => p.evaluate(() => { const g = window.shooterZ.match.game, a = g.agents[0]; return { x: a.x, z: a.z, yaw: a.yaw, shots: a.shots, abilityCd: a.abilityCooldown, alive: a.alive, tick: g.tick }; });

// ---- 1. portrait: rotate prompt, watch still there
{
  const { ctx, p } = await phonePage({ width: 390, height: 844 });
  await p.goto(`${BASE}/?seed=3`);
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${out}/touch-portrait-menu.png` });
  var portrait = await p.evaluate(() => ({ rotate: !!document.querySelector(".rotate") && getComputedStyle(document.querySelector(".rotate")).display !== "none", play: getComputedStyle(document.getElementById("playTouch")).display !== "none", watch: getComputedStyle(document.getElementById("watchPhone")).display !== "none" }));
  await ctx.close();
}

// ---- 2. landscape play: stick + aim + fire at once, then Special Move
const A = await phonePage(L, true);
await A.p.goto(`${BASE}/?seed=3&nofs`);
await A.p.waitForTimeout(2200);
await A.p.screenshot({ path: `${out}/touch-landscape-menu.png` });
const menuDefaults = await A.p.evaluate(() => ({ skill: document.querySelector("[data-setting=skill] .on")?.textContent, graphics: document.querySelector("[data-setting=graphics] .on")?.textContent }));
await A.p.tap("#playTouch");
await A.p.waitForTimeout(1500);
const before = await game(A.p);
await A.T.down(1, 150, 290);                      // left thumb: stick
await A.T.move(1, 150, 230);                      // push up = forward
await A.T.down(2, 560, 170);                      // right thumb: aim
for (let i = 1; i <= 10; i++) { await A.T.move(2, 560 + i * 8, 170); await A.p.waitForTimeout(40); }
await A.T.down(3, BTN.fire.x, BTN.fire.y);        // third finger: fire
await A.p.waitForTimeout(900);
await A.p.screenshot({ path: `${out}/touch-landscape-play.png` });
const during = await game(A.p);
await A.T.up(3); await A.T.up(2); await A.T.up(1);
await A.T.tap(BTN.ability.x, BTN.ability.y);
await A.p.waitForTimeout(300);
const after = await game(A.p);
// pause and resume
await A.T.tap(844 - 12 - 23, 10 + 23);
await A.p.waitForTimeout(300);
const pausedShown = await A.p.evaluate(() => !document.getElementById("pause").hidden);
await A.p.tap("#resume");
await A.p.waitForTimeout(300);
const resumed = await A.p.evaluate(() => !window.shooterZ.touchPaused);
// a bit more play for the clip: strafe and shoot at the bot when it's in view
for (let k = 0; k < 40; k++) {
  const s = await A.p.evaluate(() => {
    const g = window.shooterZ.match.game, me = g.agents[0], t = g.agents[1];
    const dx = t.x - me.x, dz = t.z - me.z, ey = Math.atan2(-dx, -dz) - me.yaw, w = ey - 2 * Math.PI * Math.floor((ey + Math.PI) / (2 * Math.PI));
    return { ey: w, clear: t.alive && g.world.clear(me.x, me.y + 1.6, me.z, t.x, t.y + 1.2, t.z) };
  });
  if (k === 0) { await A.T.down(1, 150, 290); await A.T.down(2, 600, 170); }
  await A.T.move(1, 150 + (k % 20 < 10 ? 50 : -50), s.clear ? 290 : 235);
  await A.T.move(2, 600 + Math.max(-60, Math.min(60, (-s.ey * 0.6) / 0.006)), 170);
  await A.T.up(2); await A.T.down(2, 600, 170);
  if (s.clear) await A.T.down(3, BTN.fire.x, BTN.fire.y); else if (k % 2) await A.T.up(3);
  await A.p.waitForTimeout(100);
}
await A.T.up(3); await A.T.up(2); await A.T.up(1);
await A.ctx.close();

// ---- 3. the tutorial by touch
const B = await phonePage(L);
const p = B.p, T = B.T;
await p.goto(`${BASE}/?seed=3`);
await p.waitForTimeout(2000);
await p.tap("#tutorialTouch");
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/touch-tutorial-step1.png` });
const aimDrag = async (part) => {
  const s = await p.evaluate((part) => {
    const g = window.shooterZ.match.game, me = g.agents[0], t = g.agents[1];
    if (!t.alive || !me.alive) return null;
    const eye = me.y + (me.crouch ? 1.1 : 1.62), ty = t.y + (part === "head" ? (t.crouch ? 1.1 : 1.6) : (t.crouch ? 0.75 : 1.12));
    const dx = t.x - me.x, dz = t.z - me.z, d = Math.hypot(dx, dz);
    const w = (v) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));
    return { ey: w(Math.atan2(-dx, -dz) - me.yaw), ep: Math.atan2(ty - eye, d) - me.pitch, clear: g.world.clear(me.x, eye, me.z, t.x, ty, t.z) };
  }, part);
  if (!s) return { fire: false, clear: false };
  const px = Math.max(-80, Math.min(80, (-s.ey * 0.6) / 0.006)), py = Math.max(-60, Math.min(60, (-s.ep * 0.6) / 0.006));
  await T.down(2, 600, 190); await T.move(2, 600 + px, 190 + py); await T.up(2);
  const tol = part === "head" ? 0.012 : 0.03;
  return { fire: s.clear && Math.abs(s.ey) < tol && Math.abs(s.ep) < tol, clear: s.clear };
};
let last = -1;
const t0 = Date.now();
const stepTimes = [];
while (Date.now() - t0 < 180000) {
  const st = await p.evaluate(() => ({ i: window.shooterZ.tutorial.index, done: window.shooterZ.tutorial.done }));
  if (st.i !== last) { if (last >= 0) stepTimes.push(((Date.now() - t0) / 1000).toFixed(1)); last = st.i; for (const id of [1, 3]) await T.up(id).catch(() => {}); if (st.i === 4) await p.screenshot({ path: `${out}/touch-tutorial-headshot.png` }); }
  if (st.done) break;
  switch (st.i) {
    case 0: await T.down(2, 600, 190); await T.move(2, 680, 190); await T.up(2); break;
    case 1: await T.down(1, 150, 290); await T.move(1, 150, 230); await p.waitForTimeout(400); await T.up(1); break;
    case 2: await T.tap(BTN.jump.x, BTN.jump.y); await p.waitForTimeout(200); await T.tap(BTN.crouch.x, BTN.crouch.y); await p.waitForTimeout(200); await T.tap(BTN.crouch.x, BTN.crouch.y); break;
    case 3: case 7: case 8: {
      const a = await aimDrag(st.i === 3 ? "torso" : "head");
      if (st.i === 8 && !a.clear) { await T.down(1, 150, 290); await T.move(1, 150, 235); } else await T.up(1).catch(() => {});
      if (a.fire) await T.down(3, BTN.fire.x, BTN.fire.y); else await T.up(3).catch(() => {});
      break;
    }
    case 4: { const a = await aimDrag("head"); if (a.fire) await T.tap(BTN.fire.x, BTN.fire.y, 3); break; }
    case 5: await T.tap(BTN.reload.x, BTN.reload.y); break;
    case 6: await T.tap(BTN.ability.x, BTN.ability.y); break;
  }
  await p.waitForTimeout(50);
}
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/touch-tutorial-done.png` });
const tut = await p.evaluate(() => ({ done: window.shooterZ.tutorial.done, endButtons: !document.getElementById("touchEnd").hidden }));
await B.ctx.close();
await b.close();

if (vids && videoOut) {
  const f = readdirSync(vids).filter((x) => x.endsWith(".webm"))[0];
  // the recording starts on the menu; keep it all (about 15 s) at real speed
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(vids, f), "-vf", "fps=30,scale=1688:-2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", videoOut], { stdio: "inherit" });
}
console.log(JSON.stringify({
  portrait, menuDefaults,
  moved: Math.hypot(during.x - before.x, during.z - before.z).toFixed(2), turned: Math.abs(during.yaw - before.yaw).toFixed(2), shotsWhileMovingAndAiming: during.shots - before.shots,
  specialMoveUsed: after.abilityCd > 0, pausedShown, resumed,
  tutorial: tut, tutorialStepTimes: stepTimes, errors: errs.length ? errs : "none",
}));
