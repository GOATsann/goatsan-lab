// Echo's Scan and the Special Move sounds, in headless Chromium:
// an enemy 15 m away behind a container is exposed as a red silhouette through the wall (with its red arrow)
// for the scan's 1.5 s, the scanner sees the screen ring, the sound files load, and nothing else is outlined.
//   node test/tools/scan-check.mjs <screenshot dir>
import { chromium } from "playwright";

const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:5190/?autotest&seed=8");
await p.waitForTimeout(3000);
await p.click('#chars [data-c="2"]'); // Echo
await p.click("[data-setting=mode] [data-v=duel]");
await p.click("[data-setting=map] [data-v=base]");
await p.click("#play");
await p.waitForTimeout(2500); // spawn protection over, samples loaded
// you at the south spawn looking north-west; the enemy behind the orange container, 15 m away
const placed = await p.evaluate(() => {
  const z = window.shooterZ, g = z.match.game;
  z.match.paused[1] = true; // hold the bot still for the check
  g.teleport(0, 0, 18.5, Math.atan2(12, 9));
  g.teleport(1, -12, 9.5, 0);
  const me = g.agents[0], t = g.agents[1];
  return { hidden: !g.world.clear(me.x, me.y + 1.62, me.z, t.x, t.y + 1.2, t.z), dist: Math.hypot(t.x - me.x, t.z - me.z).toFixed(1) };
});
await p.waitForTimeout(300);
const ghostVisible = () => p.evaluate(() => { const v = window.shooterZ.view; return { ghost: v.scanGhost[1].some((x) => x.visible), arrow: v.markers[1].visible, ring: !!document.querySelector(".scanring") }; });
const before = await ghostVisible();
await p.keyboard.down("KeyE"); await p.waitForTimeout(80); await p.keyboard.up("KeyE");
await p.waitForTimeout(250);
const during = await ghostVisible();
await p.screenshot({ path: `${out}/scan-through-wall.png` });
await p.waitForTimeout(1700);
const after = await ghostVisible();
const audio = await p.evaluate(() => ({ samples: [...window.shooterZ.sfx.samples.keys()].sort(), state: window.shooterZ.sfx.ctx?.state ?? "none" }));
console.log(JSON.stringify({ placed, before, during, after, audio, errors: errs.length ? errs : "none" }));
await b.close();
