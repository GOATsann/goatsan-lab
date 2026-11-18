// Menu + tutorial check in headless Chromium, with screen recordings for the process clips.
//   node test/tools/tutorial-check.mjs <screenshot dir> [video dir]
// 1. First visit: the menu suggests the tutorial; character select shows the 3D preview + Special Move.
// 2. The tutorial is played through by script (same input path as the mouse/keyboard), every step must
//    complete on its own (no skipping). No console errors allowed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const [out, videoOut] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const errs = [];
const vids = videoOut ? mkdtempSync(join(tmpdir(), "shooterz-vid-")) : null;
const size = { width: 1600, height: 900 };

async function page(record) {
  const ctx = await b.newContext({ viewport: size, ...(record && vids ? { recordVideo: { dir: vids, size } } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  return { ctx, p };
}

// ---- 1. menu on a first visit
const A = await page(true);
await A.p.goto("http://localhost:5190/?autotest&rulebots&seed=2");
await A.p.waitForTimeout(2500);
const firstVisitShown = await A.p.isVisible("#firstVisit");
await A.p.screenshot({ path: `${out}/menu-first-visit.png` });
for (const c of [1, 2, 3, 0]) {
  await A.p.click(`#chars [data-c="${c}"]`);
  await A.p.waitForTimeout(1300);
  if (c === 1) await A.p.screenshot({ path: `${out}/menu-character-bulwark.png` });
}
await A.p.click("[data-setting=limit] [data-v='15']");
const limitOn = await A.p.textContent("[data-setting=limit] .on");
// keyboard: Tab to a segmented button and press Enter
await A.p.focus("[data-setting=skill] [data-v=hard]");
await A.p.keyboard.press("Enter");
const skillOn = await A.p.textContent("[data-setting=skill] .on");
await A.p.click("[data-setting=skill] [data-v=normal]");
await A.p.click("[data-setting=limit] [data-v='10']");
const preview = await A.p.evaluate(() => ({ name: document.getElementById("cpName").textContent, move: document.getElementById("cpMove").textContent, cd: document.getElementById("cpCd").textContent }));
const selects = await A.p.evaluate(() => document.querySelectorAll("select").length);
await A.p.waitForTimeout(800);
await A.ctx.close();

// ---- 2. the tutorial
const B = await page(true);
const p = B.p;
await p.goto("http://localhost:5190/?autotest&rulebots&seed=2");
await p.waitForTimeout(2000);
await p.click("#chars [data-c='0']");
await p.click("#tutorial");
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/tutorial-step1.png` });
const t0 = Date.now();
const steps = [];
let lastStep = -1;
await p.mouse.move(800, 450);
const aim = (part) => p.evaluate((part) => {
  const z = window.shooterZ, g = z.match.game, me = g.agents[0], t = g.agents[1];
  if (!t.alive || !me.alive) return { clear: false, fire: false };
  const eyeY = me.y + (me.crouch ? 1.1 : 1.62);
  const ty = t.y + (part === "head" ? (t.crouch ? 1.1 : 1.6) : (t.crouch ? 0.75 : 1.12));
  const dx = t.x - me.x, dz = t.z - me.z, d = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(ty - eyeY, d);
  const wrap = (v) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));
  const ey = wrap(yaw - me.yaw), ep = pitch - me.pitch;
  const clear = g.world.clear(me.x, eyeY, me.z, t.x, ty, t.z);
  const s = z.input.sensitivity;
  z.input.addMouse((-ey * 0.6) / s, (-ep * 0.6) / s);
  return { clear, fire: clear && Math.abs(ey) < (part === "head" ? 0.012 : 0.03) && Math.abs(ep) < (part === "head" ? 0.012 : 0.03) };
}, part);
while (Date.now() - t0 < 150000) {
  const st = await p.evaluate(() => { const t = window.shooterZ.tutorial; return { i: t.index, done: t.done, title: t.steps[t.index]?.title ?? "" }; });
  if (st.i !== lastStep) {
    await p.mouse.up();
    for (const k of ["KeyW", "KeyC"]) await p.keyboard.up(k);
    if (lastStep >= 0) steps.push({ step: lastStep, secs: ((Date.now() - t0) / 1000).toFixed(1) });
    lastStep = st.i;
    if (st.i === 4) await p.screenshot({ path: `${out}/tutorial-headshot-step.png` });
    if (st.i === 8) await p.screenshot({ path: `${out}/tutorial-fighter-step.png` });
  }
  if (st.done) break;
  switch (st.i) {
    case 0: await p.evaluate(() => window.shooterZ.input.addMouse(120, 0)); break;
    case 1: await p.keyboard.down("KeyW"); break;
    case 2: await p.keyboard.press("Space"); await p.keyboard.down("KeyC"); await p.waitForTimeout(300); await p.keyboard.up("KeyC"); break;
    case 3: case 7: case 8: {
      const a = await aim(st.i === 3 ? "torso" : "head");
      if (st.i === 8) { if (!a.clear) await p.keyboard.down("KeyW"); else await p.keyboard.up("KeyW"); }
      if (a.fire) await p.mouse.down(); else await p.mouse.up();
      break;
    }
    case 4: { const a = await aim("head"); if (a.fire) { await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up(); } break; }
    case 5: await p.keyboard.press("KeyR"); break;
    case 6: await p.keyboard.press("KeyE"); break;
  }
  await p.waitForTimeout(50);
}
await p.mouse.up();
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/tutorial-complete.png` });
const final = await p.evaluate(() => ({ done: window.shooterZ.tutorial.done, steps: window.shooterZ.tutorial.steps.length, stored: localStorage.getItem("shooter-z:tutorialDone") }));
await p.waitForTimeout(1200);
await B.ctx.close();
await b.close();

// ---- videos: menu clip as is, tutorial as a fast time-lapse
if (vids) {
  const files = readdirSync(vids).filter((f) => f.endsWith(".webm")).map((f) => join(vids, f));
  const enc = (src, dst, speed) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `setpts=PTS/${speed},fps=30,scale=1920:-2`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", dst], { stdio: "inherit" });
  // Playwright names videos randomly; the menu context was created first, so its file is older
  files.sort((x, y) => spawnSync("stat", ["-f", "%B", x]).stdout.toString() - spawnSync("stat", ["-f", "%B", y]).stdout.toString());
  if (files[0]) enc(files[0], join(videoOut, "15_menu_controls_character_select_16x9.mp4"), 1);
  if (files[1]) enc(files[1], join(videoOut, "16_tutorial_timelapse_16x9.mp4"), 6);
}
console.log(JSON.stringify({ firstVisitShown, limitOn, skillOn, selects, preview, steps, ...final, errors: errs.length ? errs : "none" }));
