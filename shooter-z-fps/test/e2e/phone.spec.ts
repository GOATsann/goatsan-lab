// Phone flows by real taps, incl. the user-found iPhone bugs (USER_STORIES.md). Phones only.
import { expect, test } from "@playwright/test";
import { endMatch, expectFrozen, expectTicking, openMenu, shown, startMatch, state, tick, touchControlsOff, watchErrors } from "./game";

test.skip(({ isMobile }) => !isMobile, "phone flows");

test("pause menu by tap, then Leave match returns to the menu", async ({ page }) => {
  const errors = watchErrors(page);
  await openMenu(page);
  await startMatch(page, true);
  await page.tap(".t-pause");
  await expect.poll(() => shown(page, "pause")).toBe(true);
  expect(await touchControlsOff(page)).toBe(true); // the touch controls step aside
  await expectFrozen(page);
  await page.tap("#quit");
  await expect.poll(() => state(page)).toBe("menu");
  expect(errors).toEqual([]);
});

test("pause by tap, Resume plays on", async ({ page }) => {
  await openMenu(page);
  await startMatch(page, true);
  await page.tap(".t-pause");
  await expect.poll(() => shown(page, "pause")).toBe(true);
  await page.tap("#resume");
  await expect.poll(() => shown(page, "pause")).toBe(false);
  await expectTicking(page);
  expect(await touchControlsOff(page)).toBe(false);
});

test("after a match ends, Play again and Menu work by tap", async ({ page }) => {
  const errors = watchErrors(page);
  await openMenu(page);
  await startMatch(page, true);
  await endMatch(page);
  await expect.poll(() => shown(page, "touchEnd")).toBe(true);
  expect(await touchControlsOff(page)).toBe(true);
  await page.tap("#againBtn");
  await page.waitForFunction(() => { const z = (window as never as { shooterZ: { state: string; match: { game: { over: boolean; tick: number } } } }).shooterZ; return z.state === "play" && !z.match.game.over && z.match.game.tick > 30; });
  await endMatch(page);
  await expect.poll(() => shown(page, "touchEnd")).toBe(true);
  await page.tap("#menuBtn");
  await expect.poll(() => state(page)).toBe("menu");
  expect(errors).toEqual([]);
});

test("turning the phone upright pauses at once; landscape brings back Resume", async ({ page, viewport }) => {
  await openMenu(page);
  await startMatch(page, true);
  const land = viewport!;
  await page.setViewportSize({ width: land.height, height: land.width });
  await expect.poll(() => shown(page, "rotatePause")).toBe(true);
  expect(await shown(page, "pause")).toBe(false);
  expect(await touchControlsOff(page)).toBe(true);
  await expectFrozen(page, 700); // no ticks while upright
  await page.setViewportSize(land);
  await expect.poll(() => shown(page, "pause")).toBe(true);
  expect(await shown(page, "rotatePause")).toBe(false);
  const size = await page.evaluate(() => { const c = document.getElementById("view")!; return [c.clientWidth, c.clientHeight, innerWidth, innerHeight]; });
  expect([size[0], size[1]]).toEqual([size[2], size[3]]); // the canvas follows the new size
  const t = await tick(page);
  await page.tap("#resume");
  await expect.poll(() => tick(page)).toBeGreaterThan(t);
});

test("the page going to the background pauses the match", async ({ page }) => {
  await openMenu(page);
  await startMatch(page, true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => shown(page, "pause")).toBe(true);
  await expectFrozen(page);
});
