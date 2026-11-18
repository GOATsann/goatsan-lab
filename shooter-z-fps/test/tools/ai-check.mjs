// The trained AI in the browser: Watch AI vs AI on both maps (they should meet and fight), then a 1v1
// played against it. Reports eliminations, hits, fps, inference time per decision and console errors,
// and (optionally) records a "trained AI vs AI" clip around the first elimination.
//   node test/tools/ai-check.mjs <screenshot dir> [seconds per map] [clip out .mp4]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const [out, secArg = "90", clipOut] = process.argv.slice(2);
const secs = Number(secArg);
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const errs = [];
const size = { width: 1600, height: 900 };
const report = {};

async function watchMap(map, record) {
  const vids = record ? mkdtempSync(join(tmpdir(), "shooterz-ai-")) : null;
  const ctx = await b.newContext({ viewport: size, ...(vids ? { recordVideo: { dir: vids, size } } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const t0 = Date.now();
  await p.goto("http://localhost:5190/?autotest&fps&seed=11");
  await p.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 60000 });
  const loadedAt = (Date.now() - t0) / 1000;
  const menu = await p.evaluate(() => ({ levelChoiceHidden: document.getElementById("levelField").hidden, ruleBotChoice: !!document.querySelector("[data-setting=opponents]"), backdropAI: !!window.shooterZ.ai }));
  menu.modelReadyAfterS = loadedAt.toFixed(1);
  await p.click("[data-setting=mode] [data-v=duel]");
  await p.click(`[data-setting=map] [data-v=${map}]`);
  await p.click("#watch");
  await p.waitForFunction(() => window.shooterZ?.state === "watch", null, { timeout: 30000 });
  const watchAt = (Date.now() - t0) / 1000;
  let firstKillAt = -1, minDist = Infinity, shots = 0, hits = 0, kills = 0, fps = "", slots = [];
  const s0 = Date.now();
  while (Date.now() - s0 < secs * 1000) {
    await p.waitForTimeout(500);
    const s = await p.evaluate(() => {
      const z = window.shooterZ, g = z.match.game, [a, c] = g.agents;
      return {
        d: Math.hypot(a.x - c.x, a.z - c.z), shots: a.shots + c.shots, hits: a.hits + c.hits, kills: a.kills + c.kills,
        fps: document.querySelector(".fps")?.textContent ?? "", ai: !!z.ai, slots: z.match.options.slots.map((x) => x.kind), ms: z.ai ? z.ai.avgMs() : 0, n: z.ai ? z.ai.times.length : 0,
      };
    });
    minDist = Math.min(minDist, s.d); shots = s.shots; hits = s.hits; fps = s.fps; slots = s.slots;
    if (s.kills > kills && firstKillAt < 0) { firstKillAt = (Date.now() - t0) / 1000; await p.screenshot({ path: `${out}/ai-vs-ai-${map}-kill.png` }); }
    kills = Math.max(kills, s.kills);
    report[`watch_${map}`] = { menu, slots, minDist: minDist.toFixed(1), shots, hits, kills, fps, inferenceMsAvg: s.ms.toFixed(2), decisionsTimed: s.n };
  }
  await p.screenshot({ path: `${out}/ai-vs-ai-${map}.png` });
  await ctx.close();
  if (vids && clipOut) {
    const f = readdirSync(vids).filter((x) => x.endsWith(".webm"))[0];
    const start = firstKillAt > 0 ? Math.max(watchAt + 1, firstKillAt - 5) : watchAt + 4;
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(start), "-t", "8", "-i", join(vids, f), "-vf", "fps=30,scale=1920:-2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", clipOut], { stdio: "inherit" });
  }
}

await watchMap("base", true);
await watchMap("ship", false);

// ---- a 1v1 against the trained AI (scripted aim through the mouse path, like play-check)
{
  const ctx = await b.newContext({ viewport: size });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto("http://localhost:5190/?autotest&fps&seed=12");
  await p.waitForTimeout(2500);
  await p.click("[data-setting=mode] [data-v=duel]");
  await p.click("[data-setting=map] [data-v=base]");
  await p.click("#play");
  await p.waitForFunction(() => window.shooterZ?.state === "play" && window.shooterZ.ai, null, { timeout: 30000 });
  await p.mouse.move(800, 450);
  const s0 = Date.now();
  let r = {};
  while (Date.now() - s0 < 45000) {
    r = await p.evaluate(() => {
      const z = window.shooterZ, g = z.match.game, me = g.agents[0], t = g.agents[1];
      const eye = me.y + (me.crouch ? 1.1 : 1.62);
      const dx = t.x - me.x, dz = t.z - me.z, d = Math.hypot(dx, dz);
      const clear = t.alive && me.alive && g.world.clear(me.x, eye, me.z, t.x, t.y + 1.15, t.z);
      const w = (v) => v - 2 * Math.PI * Math.floor((v + Math.PI) / (2 * Math.PI));
      let fire = false;
      if (clear) {
        const ey = w(Math.atan2(-dx, -dz) - me.yaw), ep = Math.atan2(t.y + 1.15 - eye, d) - me.pitch, s = z.input.sensitivity;
        z.input.addMouse((-ey * 0.5) / s, (-ep * 0.5) / s);
        fire = Math.abs(ey) < 0.05 && Math.abs(ep) < 0.05;
      }
      return { clear, fire, myKills: me.kills, aiKills: t.kills, aiHitsOnMe: t.hits, myHits: me.hits, fps: document.querySelector(".fps")?.textContent ?? "", ms: z.ai.avgMs().toFixed(2) };
    });
    if (r.fire) await p.mouse.down(); else await p.mouse.up();
    if (!r.clear) await p.keyboard.down("KeyW"); else await p.keyboard.up("KeyW");
    await p.waitForTimeout(60);
  }
  await p.screenshot({ path: `${out}/play-vs-ai.png` });
  report.play_vs_ai = r;
  await ctx.close();
}
await b.close();
console.log(JSON.stringify({ ...report, errors: errs.length ? errs.slice(0, 5) : "none" }, null, 1));
