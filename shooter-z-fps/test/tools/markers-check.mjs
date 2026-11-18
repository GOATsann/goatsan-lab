// Desktop check: (1) the character-select preview plays every Special Move with its effects and flashes
// the move's name; (2) friend-or-foe markers in a 2v2: green over the teammate always, red over an
// opponent only while it is visible to you or revealed. Records the menu + markers process clip.
//   node test/tools/markers-check.mjs <screenshot dir> [menu clip .mp4] [markers clip .mp4]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const [out, clipOut, markersOut] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const vids = clipOut ? mkdtempSync(join(tmpdir(), "shooterz-markers-")) : null;
const size = { width: 1600, height: 900 };
const ctx = await b.newContext({ viewport: size, ...(vids ? { recordVideo: { dir: vids, size } } : {}) });
const p = await ctx.newPage();
const tStart = Date.now();
let playAt = 0;
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:5190/?autotest&seed=4");
await p.waitForTimeout(3500); // the character models load

// ---- 1. preview: each character's Special Move, caught mid-effect
const preview = {};
for (const [c, name, at] of [[1, "bulwark", 1.9], [2, "echo", 1.75], [3, "wisp", 2.4], [0, "dash", 1.27]]) {
  await p.click(`#chars [data-c="${c}"]`);
  await p.waitForTimeout(at * 1000);
  await p.locator("#charPreview").screenshot({ path: `${out}/preview-${name}.png` });
  preview[name] = await p.evaluate(() => ({ flash: document.querySelector(".cp-flash")?.classList.contains("on"), text: document.querySelector(".cp-flash")?.textContent }));
  await p.waitForTimeout(1200);
}
await p.click(`#chars [data-c="0"]`);
await p.waitForTimeout(600);

// ---- 2. markers in a 2v2
await p.click("[data-setting=mode] [data-v=team]");
await p.click("[data-setting=map] [data-v=base]");
await p.click("#play");
playAt = (Date.now() - tStart) / 1000;
await p.waitForTimeout(1500);
const stats = { frames: 0, mateShown: 0, mateMissing: 0, foeShown: 0, foeShownThroughWall: 0, foeVisibleButHidden: 0, foeRevealedShown: 0 };
let shot = 0;
const t0 = Date.now();
while (Date.now() - t0 < 45000) {
  const f = await p.evaluate(() => {
    const z = window.shooterZ, g = z.match.game, me = g.agents[0], v = z.view;
    const eye = me.y + (me.crouch ? 1.1 : 1.62);
    const rows = [];
    for (const a of g.agents) {
      if (a.id === 0 || !a.alive) continue;
      const mk = v.markers[a.id];
      const h = a.crouch ? 0.69 : 1;
      const sees = me.alive && (g.world.clear(me.x, eye, me.z, a.x, a.y + 1.6 * h, a.z) || g.world.clear(me.x, eye, me.z, a.x, a.y + 1.15 * h, a.z));
      const cloakedFar = g.cloaked(a) && Math.hypot(a.x - me.x, a.z - me.z) > 6;
      const revealed = a.outlineFor[0] > 0 || a.revealTicks > 0 || a.scanFor[me.team] > 0;
      rows.push({ mate: a.team === me.team, shown: mk.visible, color: "#" + mk.material.color.getHexString(), sees: sees && !cloakedFar, revealed });
    }
    // turn slowly so robots come in and out of view
    z.input.addMouse(3, 0);
    return rows;
  });
  stats.frames++;
  let mateUp = false, foeUp = false;
  for (const r of f) {
    if (r.mate) { if (r.shown) { stats.mateShown++; mateUp = true; } else stats.mateMissing++; continue; }
    if (r.shown) { stats.foeShown++; foeUp = true; if (!r.sees && !r.revealed) stats.foeShownThroughWall++; if (r.revealed && !r.sees) stats.foeRevealedShown++; }
    else if (r.sees || r.revealed) stats.foeVisibleButHidden++;
  }
  if (mateUp && foeUp && shot < 3) { await p.screenshot({ path: `${out}/markers-${shot}.png` }); shot++; }
  await p.waitForTimeout(100);
}
await ctx.close();
await b.close();
if (vids && clipOut) {
  const f = readdirSync(vids).filter((x) => x.endsWith(".webm"))[0];
  // the menu with the previews (from 2.5 s) and the start of the 2v2 with markers, ~8 s at 2x speed
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2.5", "-t", "16", "-i", join(vids, f), "-vf", "setpts=PTS/2,fps=30,scale=1920:-2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", clipOut], { stdio: "inherit" });
  // the 2v2 with the markers: from a few seconds into the match, 8 s at real speed
  if (markersOut) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(playAt + 6), "-t", "8", "-i", join(vids, f), "-vf", "fps=30,scale=1920:-2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", markersOut], { stdio: "inherit" });
}
console.log(JSON.stringify({ preview, markers: stats, errors: errs.length ? errs : "none" }));
