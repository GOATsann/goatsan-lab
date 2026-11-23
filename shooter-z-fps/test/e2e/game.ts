// Helpers for the e2e tests: the game exposes window.shooterZ for tests (src/web/main.ts).
import { expect, type Page } from "@playwright/test";

export type W = { shooterZ: { state: string; match: { game: { tick: number; over: boolean; winnerTeam: number } } } };

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Open the menu (no fullscreen request: tests can't grant it) and wait until the AI has loaded. */
export async function openMenu(page: Page, query = ""): Promise<void> {
  await page.goto(`/?nofs${query ? `&${query}` : ""}`);
  await page.waitForFunction(() => !document.body.classList.contains("ai-wait"), null, { timeout: 90_000 });
}

export const state = (page: Page) => page.evaluate(() => (window as unknown as W).shooterZ.state);
export const tick = (page: Page) => page.evaluate(() => (window as unknown as W).shooterZ.match.game.tick);
export const shown = (page: Page, id: string) => page.evaluate((i) => { const e = document.getElementById(i); return !!e && !e.hidden && getComputedStyle(e).display !== "none"; }, id);
export const touchControlsOff = (page: Page) =>
  page.evaluate(() => { const t = document.querySelector(".touch"); return !t || getComputedStyle(t).display === "none"; });

/** Start a match from the menu with the button for this device (tap on phones, click on desktop). */
export async function startMatch(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) await page.tap("#playTouch");
  else await page.click("#play");
  await page.waitForFunction(() => { const z = (window as unknown as W).shooterZ; return z?.state === "play" && z.match.game.tick > 30; }, null, { timeout: 30_000 });
}

/** End the current match at once (blue loses), as if the last elimination just happened. */
export const endMatch = (page: Page) => page.evaluate(() => { const g = (window as unknown as W).shooterZ.match.game; g.over = true; g.winnerTeam = 1; });

export async function expectTicking(page: Page, ms = 600): Promise<void> {
  const a = await tick(page);
  await page.waitForTimeout(ms);
  expect(await tick(page)).toBeGreaterThan(a);
}

export async function expectFrozen(page: Page, ms = 600): Promise<void> {
  const a = await tick(page);
  await page.waitForTimeout(ms);
  expect(await tick(page)).toBe(a);
}
