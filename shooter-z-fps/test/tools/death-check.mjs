// Death cam check: stand still against a Hard bot until it eliminates you; the camera should pull back
// to third person around your own robot, name the killer, then respawn you into first person.
//   node test/tools/death-check.mjs <outdir>
import { chromium } from "playwright";

const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:5190/?autotest&seed=5");
await p.waitForTimeout(2000);
await p.click("[data-setting=mode] [data-v=duel]");
await p.click("[data-setting=skill] [data-v=hard]");
await p.click("#play");
const state = () => p.evaluate(() => {
  const z = window.shooterZ, g = z.match.game, me = g.agents[0], c = z.view.stage.camera.position;
  const eyeDist = Math.hypot(c.x - me.x, c.y - (me.y + 1.62), c.z - me.z);
  const k = z.view.killedBy?.[0] ?? -1;
  return { alive: me.alive, deaths: me.deaths, eyeDist, center: document.querySelector(".center")?.textContent ?? "", tick: g.tick, killerArrow: k >= 0 ? z.view.markers[k].visible : null };
});
let s = await state();
const t0 = Date.now();
// walk toward the middle so the bot finds us, then stand still
await p.keyboard.down("KeyW");
while (s.alive && Date.now() - t0 < 90000) { await p.waitForTimeout(100); s = await state(); if (Date.now() - t0 > 2500) await p.keyboard.up("KeyW"); }
await p.keyboard.up("KeyW");
const result = { died: !s.alive };
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/deathcam-1.png` });
const early = await state();
await p.waitForTimeout(1000);
await p.screenshot({ path: `${out}/deathcam-2.png` });
const late = await state();
let back = await state();
while (!back.alive && Date.now() - t0 < 100000) { await p.waitForTimeout(100); back = await state(); }
await p.waitForTimeout(300);
back = await state();
await p.screenshot({ path: `${out}/deathcam-respawned.png` });
Object.assign(result, { earlyCamDist: early.eyeDist.toFixed(2), lateCamDist: late.eyeDist.toFixed(2), center: late.center, killerArrowOnDeathCam: late.killerArrow, respawned: back.alive, respawnCamDist: back.eyeDist.toFixed(2) });
console.log(JSON.stringify({ ...result, errors: errs.length ? errs : "none" }));
await b.close();
