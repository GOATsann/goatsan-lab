// Race the AI (LS-085..LS-097) and Watch the AI (LS-099..LS-107).
import { expect, test, type Page } from "@playwright/test";
import { open } from "./game";

type R = { you: { tick: number; dead: boolean; score: number; options: { level: number } }; ai: { tick: number; dead: boolean; score: number; options: { level: number } }; phase: string; driver?: string };
const race = (page: Page) => page.evaluate(() => (window as unknown as { race: () => R }).race());
type Wt = { game: { tick: number; options: { level: number } }; runs: number; best: number; driver?: string };
const watch = (page: Page) => page.evaluate(() => (window as unknown as { watch: () => Wt }).watch());

test("LS-085/087/088/089: Race the AI opens with my name and level, counts down, both run", async ({ page }) => {
  await open(page);
  await page.fill("#name", "Tester");
  await page.click('[data-level="2"]');
  await page.click("#race");
  await page.waitForURL(/race\.html/);
  await expect(page.locator("#youName")).toHaveText("Tester");
  await expect(page.locator("#aiName")).toHaveText("AI"); // just "AI" (user's call)
  await expect.poll(async () => (await race(page)).phase, { timeout: 60_000 }).toMatch(/count|race/);
  await expect.poll(async () => (await race(page)).phase, { timeout: 30_000 }).toBe("race");
  const r = await race(page);
  expect(r.ai.options.level).toBe(2); // the start level sets the AI's difficulty
  await expect.poll(async () => { const x = await race(page); return Math.min(x.you.tick, x.ai.tick); }).toBeGreaterThan(30);
});

test("LS-086: without a stored name the player is called You", async ({ page }) => {
  await page.goto("/race.html?seed=7");
  await expect(page.locator("#youName")).toHaveText("You");
});

test("LS-092/093/094: my crash ends my half, the result shows once certain, Race again restarts", async ({ page }) => {
  await page.goto("/race.html?seed=7");
  await expect.poll(async () => (await race(page)).phase, { timeout: 60_000 }).toBe("race");
  await page.evaluate(() => { const r = (window as unknown as { race: () => { you: { dead: boolean; deathCause: string } } }).race(); r.you.dead = true; r.you.deathCause = "train front"; });
  await expect(page.locator("#youOut")).toBeVisible();
  // the AI keeps running until it is ahead (or crashes): then the result shows
  await expect.poll(async () => (await race(page)).phase, { timeout: 60_000 }).toBe("done");
  await expect(page.locator("#overlay")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#sub")).toContainText("the AI scored");
  await page.click("#again");
  await expect(page.locator("#overlay")).toBeHidden();
  await expect.poll(async () => (await race(page)).phase, { timeout: 60_000 }).toBe("race");
});

test("LS-095/096: Back leaves the race for the start page; the race has no Save", async ({ page }) => {
  await page.goto("/race.html?seed=7");
  await expect(page.locator("#save")).toHaveCount(0);
  await expect.poll(async () => (await race(page)).phase, { timeout: 60_000 }).toBe("race");
  await page.evaluate(() => { const r = (window as unknown as { race: () => { you: { dead: boolean }; ai: { dead: boolean } } }).race(); r.you.dead = true; r.ai.dead = true; });
  await expect(page.locator("#overlay")).toBeVisible({ timeout: 8000 });
  await page.click("#back");
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.endsWith("/index.html"));
  await expect(page.locator("#overlay")).toBeVisible();
});

test("LS-099/100/101: Watch the AI opens at the level (Hard by default) and runs", async ({ page }) => {
  await page.goto("/watch.html");
  await expect(page.locator("#level")).toHaveValue("2");
  await expect.poll(async () => (await watch(page)).game.tick, { timeout: 60_000 }).toBeGreaterThan(30);
  expect((await watch(page)).game.options.level).toBe(2);
  await expect(page.locator("#run")).not.toBeEmpty();
  await page.goto("/watch.html?level=0");
  await expect(page.locator("#level")).toHaveValue("0");
});

test("LS-102: changing the level starts a new run at that level", async ({ page }) => {
  await page.goto("/watch.html?level=2");
  await expect.poll(async () => (await watch(page)).game.tick, { timeout: 60_000 }).toBeGreaterThan(30);
  await page.selectOption("#level", "1");
  await expect.poll(async () => (await watch(page)).game.options.level).toBe(1);
});

test("LS-103/104/105: Hide toggles the panel; the page has no player controls; Back returns home", async ({ page, isMobile }) => {
  await page.goto("/watch.html?level=2&seed=7");
  await expect.poll(async () => (await watch(page)).game.tick, { timeout: 60_000 }).toBeGreaterThan(30);
  await page.click("#hide");
  await expect(page.locator("#panel")).toBeHidden();
  if (!isMobile) {
    await page.keyboard.press("h");
    await expect(page.locator("#panel")).toBeVisible();
  }
  for (const sel of ["#play", "#save", "#name"]) await expect(page.locator(sel)).toHaveCount(0);
});
