// Desktop flows with mouse and keyboard (USER_STORIES.md). ?autotest makes the game act as if the mouse
// were locked (headless browsers can't lock it); pause stories use a real lock instead.
import { expect, test, type Page } from "@playwright/test";
import { endMatch, expectFrozen, expectTicking, openMenu, shown, state, watchErrors } from "./game";

test.skip(({ isMobile }) => isMobile, "desktop flows");

type A = { x: number; y: number; z: number; crouch: boolean; grounded: boolean; ammo: number; shots: number; character: number; team: number };
const me = (page: Page) => page.evaluate(() => (window as never as { shooterZ: { match: { game: { agents: A[] } } } }).shooterZ.match.game.agents[0]);
const game = (page: Page) => page.evaluate(() => {
  const g = (window as never as { shooterZ: { match: { game: { options: { mode: string; scoreLimit: number }; map: { id: string }; agents: A[]; over: boolean } } } }).shooterZ.match.game;
  return { mode: g.options.mode, limit: g.options.scoreLimit, map: g.map.id, n: g.agents.length, over: g.over };
});
/** Hold a key for a moment, like a person does (the game reads keys once per frame). */
const tap = async (page: Page, key: string) => { await page.keyboard.down(key); await page.waitForTimeout(150); await page.keyboard.up(key); };
const pick = (page: Page, setting: string, v: string) => page.click(`.seg[data-setting="${setting}"] button[data-v="${v}"]`);

async function play(page: Page): Promise<void> {
  await page.click("#play");
  await page.waitForFunction(() => { const z = (window as never as { shooterZ: { state: string; match: { game: { tick: number } } } }).shooterZ; return z.state === "play" && z.match.game.tick > 30; }, null, { timeout: 30_000 });
}

test("SZ-001/002/003: the menu loads with a live AI match behind it", async ({ page }) => {
  const errors = watchErrors(page);
  await openMenu(page, "autotest");
  for (const id of ["#play", "#tutorial", "#watch"]) await expect(page.locator(id)).toBeVisible();
  expect(await state(page)).toBe("menu");
  await expectTicking(page); // the backdrop match plays
  expect(errors).toEqual([]);
});

test("SZ-010/011/012/017/024: mode, map and first-to are the match's settings and are remembered", async ({ page }) => {
  test.setTimeout(240_000); // two AI loads
  await openMenu(page, "autotest");
  await pick(page, "mode", "team");
  await pick(page, "map", "ship");
  await pick(page, "limit", "5");
  await play(page);
  expect(await game(page)).toMatchObject({ mode: "team", map: "ship", limit: 5, n: 4 });
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90_000 });
  for (const [s, v] of [["mode", "team"], ["map", "ship"], ["limit", "5"]]) {
    await expect(page.locator(`.seg[data-setting="${s}"] button[data-v="${v}"]`)).toHaveClass(/\bon\b/);
  }
});

test("SZ-015/016: AI level Easy or Hard; one is chosen at a time", async ({ page }) => {
  await openMenu(page, "autotest");
  await pick(page, "aiLevel", "easy");
  await expect(page.locator('.seg[data-setting="aiLevel"] button.on')).toHaveCount(1);
  await expect(page.locator('.seg[data-setting="aiLevel"] button[data-v="easy"]')).toHaveAttribute("aria-checked", "true");
  await play(page);
  await expectTicking(page);
});

test("SZ-060/062/066/067: Play starts first person; keys move, jump and crouch", async ({ page }) => {
  const errors = watchErrors(page);
  await openMenu(page, "autotest&seed=5");
  await play(page);
  expect(await page.evaluate(() => (window as never as { shooterZ: { rig: { mode: string } } }).shooterZ.rig.mode)).toBe("fp");
  const a = await me(page);
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  const b = await me(page);
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.5);
  const y0 = (await me(page)).y;
  await page.evaluate(() => { // the highest point, tick by tick (many ticks can pass between two samples)
    const z = (window as never as { shooterZ: { match: { step: (...a: unknown[]) => void; game: { agents: { y: number }[] } }; maxY?: number } }).shooterZ;
    const step = z.match.step.bind(z.match);
    z.maxY = -1e9;
    z.match.step = (...a: unknown[]) => { step(...a); z.maxY = Math.max(z.maxY!, z.match.game.agents[0].y); };
  });
  await tap(page, "Space");
  await expect.poll(() => page.evaluate(() => (window as never as { shooterZ: { maxY: number } }).shooterZ.maxY)).toBeGreaterThan(y0 + 0.3);
  await expect.poll(async () => (await me(page)).grounded, { timeout: 5000 }).toBe(true);
  await page.keyboard.down("c");
  await expect.poll(async () => (await me(page)).crouch).toBe(true);
  await page.keyboard.up("c");
  await expect.poll(async () => (await me(page)).crouch).toBe(false);
  expect(errors).toEqual([]);
});

test("SZ-064/065: left click fires; R reloads", async ({ page }) => {
  await openMenu(page, "autotest&seed=5");
  await play(page);
  const a = await me(page);
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect.poll(async () => (await me(page)).ammo).toBeLessThan(a.ammo);
  const fired = (await me(page)).ammo;
  await tap(page, "r");
  await expect.poll(async () => (await me(page) as A & { reloadTicks: number }).reloadTicks).toBeGreaterThan(0); // the reload started
  // 1.5 s of game time; a headless browser runs the game slower than real time
  await expect.poll(async () => (await me(page)).ammo, { timeout: 30_000 }).toBeGreaterThan(fired);
});

test("SZ-070: Tab shows the scoreboard while held", async ({ page }) => {
  await openMenu(page, "autotest");
  await play(page);
  const board = () => page.evaluate(() => { const b = document.querySelector(".board") as HTMLElement | null; return !!b && getComputedStyle(b).display !== "none"; });
  await page.keyboard.down("Tab");
  await expect.poll(board).toBe(true);
  await page.keyboard.up("Tab");
  await expect.poll(board).toBe(false);
});

test("SZ-100/101/102: losing the mouse lock pauses; Resume plays on; Leave match goes to the menu", async ({ page }) => {
  await openMenu(page); // no ?autotest: a real pointer lock
  await page.click("#play");
  await page.waitForFunction(() => (window as never as { shooterZ: { state: string } }).shooterZ.state === "play", null, { timeout: 30_000 });
  await page.click("#view").catch(() => {}); // the lock needs a click on the game
  await page.waitForTimeout(500);
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  test.skip(!locked, "this browser build gives no pointer lock headless");
  await page.evaluate(() => document.exitPointerLock());
  await expect.poll(() => shown(page, "pause")).toBe(true);
  await expectFrozen(page);
  await page.click("#resume");
  await expect.poll(() => shown(page, "pause")).toBe(false);
  await expectTicking(page);
  await page.evaluate(() => document.exitPointerLock());
  await expect.poll(() => shown(page, "pause")).toBe(true);
  await page.click("#quit");
  await expect.poll(() => state(page)).toBe("menu");
});

test("SZ-110/111: the match ends; Enter plays again, Esc goes to the menu", async ({ page }) => {
  const errors = watchErrors(page);
  await openMenu(page, "autotest");
  await play(page);
  await endMatch(page);
  await expect(page.locator(".board h2")).toBeVisible();
  await expectFrozen(page);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => { const z = (window as never as { shooterZ: { state: string; match: { game: { over: boolean; tick: number } } } }).shooterZ; return z.state === "play" && !z.match.game.over && z.match.game.tick > 30; }, null, { timeout: 30_000 });
  await endMatch(page);
  await expect(page.locator(".board h2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => state(page)).toBe("menu");
  expect(errors).toEqual([]);
});

test("SZ-120/121/122/123: Watch AI vs AI, switch robot and camera, back to the menu", async ({ page }) => {
  await openMenu(page, "autotest");
  await page.click("#watch");
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("watch");
  await expectTicking(page);
  const target = () => page.evaluate(() => (window as never as { shooterZ: { rig: { target: number; mode: string } } }).shooterZ.rig);
  const t0 = (await target()).target;
  await page.click('[data-sb="next"]');
  await expect.poll(async () => (await target()).target).not.toBe(t0);
  const m0 = (await target()).mode;
  await page.click('[data-sb="cam"]');
  await expect.poll(async () => (await target()).mode).not.toBe(m0);
  await page.click('[data-sb="menu"]');
  await expect.poll(() => state(page)).toBe("menu");
});

test("SZ-174: resizing the window resizes the game", async ({ page }) => {
  await openMenu(page, "autotest");
  await play(page);
  await page.setViewportSize({ width: 1000, height: 640 });
  await expect.poll(() => page.evaluate(() => { const c = document.getElementById("view")!; return [c.clientWidth, c.clientHeight]; })).toEqual([1000, 640]);
  await expectTicking(page);
});

test("SZ-176: reloading mid-match returns to the menu", async ({ page }) => {
  await openMenu(page, "autotest");
  await play(page);
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90_000 });
  expect(await state(page)).toBe("menu");
});
