// End-to-end check in a real (headless) Chromium: menu, start a match, move, shoot, a bot engages,
// an elimination registers, no console errors. Screenshots go to <outdir>.
//   node test/tools/play-check.mjs <outdir> [map] [mode] [seconds]
// The dev server must be running (npm run dev, port 5190). ?autotest stands in for pointer lock and the
// aiming here is scripted through the same input path as the mouse (Input.addMouse).
import { chromium } from "playwright";

const [out, map = "base", mode = "duel", secArg = "45"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(`http://localhost:5190/?autotest&seed=3&fps`);
await p.waitForTimeout(2500);
await p.click(`[data-setting=map] [data-v=${map}]`);
await p.click(`[data-setting=mode] [data-v=${mode}]`);
await p.click(`[data-setting=skill] [data-v=normal]`);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/menu-${map}.png` });
await p.click("#play");
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/play-start-${map}.png` });
// walk forward for a second
await p.keyboard.down("KeyW");
await p.waitForTimeout(1000);
await p.keyboard.up("KeyW");
const moved = await p.evaluate(() => { const a = window.shooterZ.match.game.agents[0]; return { x: a.x, z: a.z }; });

// hunt the bot: aim at the nearest visible enemy's torso through the mouse path, fire when close to on target
const result = { engaged: false, kills: 0, deaths: 0, hits: 0, headshots: 0, botHits: 0, ticks: 0 };
const t0 = Date.now();
let shotKill = false;
await p.mouse.move(800, 450);
while (Date.now() - t0 < Number(secArg) * 1000) {
  const s = await p.evaluate(() => {
    const z = window.shooterZ, g = z.match.game, me = g.agents[0];
    const bots = z.match.bots.map((bt) => bt?.state ?? null);
    let best = null, bd = 1e9;
    for (const a of g.agents) {
      if (a.id === 0 || !a.alive || a.team === me.team) continue;
      const eyeY = me.y + (me.crouch ? 1.1 : 1.62);
      const dx = a.x - me.x, dz = a.z - me.z, dy = a.y + 1.15 - eyeY;
      const d = Math.hypot(dx, dz);
      // line of sight from the core (map only)
      const clear = g.world.clear(me.x, eyeY, me.z, a.x, a.y + 1.15, a.z);
      if (d < bd) { bd = d; best = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, d), clear, d, x: a.x, z: a.z }; }
    }
    const wrap = (v) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));
    let fire = false, ey = 0, ep = 0;
    if (best && best.clear) {
      ey = wrap(best.yaw - me.yaw); ep = best.pitch - me.pitch;
      const sens = z.input.sensitivity;
      // a human-ish flick: close 60% of the error per poll
      z.input.addMouse((-ey * 0.6) / sens, (-ep * 0.6) / sens);
      fire = Math.abs(ey) < 0.05 && Math.abs(ep) < 0.05;
    }
    return { fire, clear: !!best?.clear, bots, me: { kills: me.kills, deaths: me.deaths, hits: me.hits, hs: me.headshots, alive: me.alive }, tick: g.tick, over: g.over, botHits: g.agents.filter((a) => a.id !== 0).reduce((s2, a) => s2 + a.hits, 0) };
  });
  if (s.bots.some((x) => x === "engage")) result.engaged = true;
  // walk toward the enemy when it's not in sight, so the match moves along
  if (!s.clear) { await p.keyboard.down("KeyW"); } else { await p.keyboard.up("KeyW"); }
  if (s.fire) await p.mouse.down(); else await p.mouse.up();
  Object.assign(result, { kills: s.me.kills, deaths: s.me.deaths, hits: s.me.hits, headshots: s.me.hs, botHits: s.botHits, ticks: s.tick });
  if (s.me.kills > 0 && !shotKill) {
    shotKill = true;
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/play-kill-${map}.png` });
  }
  if (s.me.hits > 0 && !result.hitShot) {
    result.hitShot = true;
    await p.screenshot({ path: `${out}/play-hit-${map}.png` });
  }
  if (result.kills >= 1 && result.engaged && result.botHits > 0 && Date.now() - t0 > 8000) break;
  await p.waitForTimeout(50);
}
await p.mouse.up();
await p.keyboard.up("KeyW");
await p.keyboard.down("Tab");
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/play-scoreboard-${map}.png` });
await p.keyboard.up("Tab");
const fps = await p.evaluate(() => document.querySelector(".fps")?.textContent ?? "");
console.log(JSON.stringify({ map, mode, moved, ...result, fps, errors: errs.length ? errs : "none" }));
await b.close();
