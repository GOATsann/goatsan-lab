// Start card, controls, the run and its end (USER_STORIES.md LS-001..LS-061).
import { expect, test } from "@playwright/test";
import { crash, g, open, recordMoves, seen, startRun, swipe, visible, watchErrors } from "./game";

test("LS-001/002/004: the page loads to the start card", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await expect(page).toHaveTitle(/Lights-Out Surfer/);
  for (const id of ["#title", "#play", "#race", "#watch", "#boardBtn"]) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator(".overlay .hint")).not.toBeEmpty();
  expect(await g(page, "tick")).toBe(0); // the run has not started
  expect(errors).toEqual([]);
});

test("LS-005: Run starts the game", async ({ page }) => {
  await open(page);
  await startRun(page);
});

test("LS-006: Space starts the game from the card", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await open(page);
  await page.locator("body").press("Space");
  await expect(page.locator("#overlay")).toBeHidden();
  await expect.poll(() => g(page, "tick")).toBeGreaterThan(5);
});

test("LS-008: typing in the name field does not start the run", async ({ page }) => {
  await open(page);
  await page.fill("#name", "");
  await page.locator("#name").pressSequentially("Ike a s d");
  await expect(page.locator("#name")).toHaveValue("Ike a s d");
  await expect(page.locator("#overlay")).toBeVisible();
  expect(await g(page, "tick")).toBe(0);
});

test("LS-009/010: the runner picker cycles and is remembered", async ({ page }) => {
  await open(page);
  const first = await page.textContent("#charName");
  await page.click("#next");
  const second = await page.textContent("#charName");
  expect(second).not.toBe(first);
  await page.reload();
  await expect(page.locator("#charName")).toHaveText(second!);
  await page.click("#prev");
  await expect(page.locator("#charName")).toHaveText(first!);
});

test("LS-011: the name is remembered and capped at 16 characters", async ({ page }) => {
  await open(page);
  await expect(page.locator("#name")).toHaveAttribute("maxlength", "16");
  await page.fill("#name", "Tester");
  await page.click("#play");
  await page.goto("/?seed=7");
  await expect(page.locator("#name")).toHaveValue("Tester");
});

test("LS-012/013: one level is chosen, it shows the AI note and is used for the run", async ({ page }) => {
  await open(page);
  await page.click('[data-level="2"]');
  await expect(page.locator('[data-level][aria-checked="true"]')).toHaveCount(1);
  await expect(page.locator('[data-level="2"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".level-info")).toContainText("AI");
  await page.reload();
  await expect(page.locator('[data-level="2"]')).toHaveAttribute("aria-checked", "true");
  await startRun(page);
  expect(await g(page, "options")).toMatchObject({ level: 2 });
});

test("LS-029/030/033: arrow keys change lanes, stop at the edge, a held key is one move", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await open(page);
  await startRun(page);
  const lane0 = await g(page, "lane");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => g(page, "lane")).toBe(lane0 - 1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => g(page, "lane")).toBe(0); // the left edge
  await page.keyboard.down("ArrowRight"); // held: one move only
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  await expect.poll(() => g(page, "lane")).toBe(1);
});

test("LS-031/032: up jumps and down rolls", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard");
  await open(page);
  await startRun(page);
  await recordMoves(page);
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await seen(page)).maxY).toBeGreaterThan(0.5);
  await expect.poll(() => g(page, "grounded"), { timeout: 5000 }).toBe(true);
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await seen(page)).rolled).toBe(true);
});

test("LS-035/036: swipes steer on a phone, a short tap does nothing", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch");
  await open(page);
  await page.tap("#play");
  await expect(page.locator("#overlay")).toBeHidden();
  const lane0 = await g(page, "lane");
  await swipe(page, 0, 0); // a tap
  await page.waitForTimeout(200);
  expect(await g(page, "lane")).toBe(lane0);
  await swipe(page, -120, 0);
  await expect.poll(() => g(page, "lane")).toBe(lane0 - 1);
  await recordMoves(page);
  await swipe(page, 0, -120);
  await expect.poll(async () => (await seen(page)).maxY).toBeGreaterThan(0.5);
});

test("LS-038: the HUD shows score, distance and coins", async ({ page }) => {
  await open(page);
  await startRun(page);
  await expect.poll(async () => Number((await page.textContent("[data-meters]"))?.replace(/\D/g, "") || 0)).toBeGreaterThan(0);
  await expect(page.locator("[data-score]")).toBeVisible();
  await expect(page.locator("[data-coins]")).toBeVisible();
});

test("LS-040: ?seed gives the same track every time", async ({ page }) => {
  await open(page, "seed=42");
  const a = await g(page, "seed");
  await page.reload();
  expect(await g(page, "seed")).toBe(a);
});

test("LS-054/055/058: a crash shows the result card, Run again starts fresh", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await startRun(page);
  await crash(page);
  await expect(page.locator("#overlay")).toBeVisible({ timeout: 6000 });
  await expect(page.locator("#sub")).toContainText("m,");
  await expect(page.locator("#sub")).toContainText("train");
  await page.click("#play");
  await expect(page.locator("#overlay")).toBeHidden();
  expect(await g(page, "dead")).toBe(false);
  await expect.poll(() => g(page, "tick")).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test("LS-060: starting a new run during the crash scene does not bring the old card back", async ({ page, isMobile }) => {
  test.fail(true, "known bug (USER_STORIES LS-060): the old card shows over the new run");
  await open(page);
  await startRun(page);
  await crash(page);
  await page.waitForTimeout(300); // the crash scene is still playing
  if (isMobile) await swipe(page, 0, 0); else await page.keyboard.press("Space");
  await page.waitForTimeout(2500);
  const bad = (await visible(page, "#overlay")) && !(await g(page, "dead"));
  expect(bad).toBe(false);
});

test("LS-061: changing the level on the game-over card applies to the next run", async ({ page }) => {
  await open(page);
  await startRun(page);
  await crash(page);
  await expect(page.locator("#overlay")).toBeVisible({ timeout: 6000 });
  if (await page.locator("#more").isVisible()) await page.click("#more"); // the compact card unfolds the settings
  await page.click('[data-level="0"]');
  await page.click("#play");
  await expect.poll(async () => (await g(page, "options")).level).toBe(0);
});

test("LS-120: reloading mid-run returns to the start card with settings kept", async ({ page }) => {
  await open(page);
  await page.click('[data-level="1"]');
  await startRun(page);
  await page.reload();
  await expect(page.locator("#overlay")).toBeVisible();
  await expect(page.locator('[data-level="1"]')).toHaveAttribute("aria-checked", "true");
  expect(await g(page, "tick")).toBe(0);
});

test("LS-112/114: the canvas fills the window and follows a resize", async ({ page, isMobile }) => {
  await open(page);
  const fill = () => page.evaluate(() => { const c = document.querySelector("canvas")!.getBoundingClientRect(); return [Math.round(c.width), Math.round(c.height), innerWidth, innerHeight]; });
  let [w, h, iw, ih] = await fill();
  expect([w, h]).toEqual([iw, ih]);
  if (!isMobile) {
    await page.setViewportSize({ width: 900, height: 600 });
    await expect.poll(fill).toEqual([900, 600, 900, 600]);
  }
});
