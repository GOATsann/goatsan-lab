// Helpers for the e2e tests: the game exposes window.game(), window.race(), window.watch() and window.sfx.
import { expect, type Page } from "@playwright/test";

type G = { tick: number; lane: number; dead: boolean; deathCause: string; grounded: boolean; rolling: boolean; y: number; seed: number;
  meters: number; coins: number; score: number; options: { level: number } };
export const g = <K extends keyof G>(page: Page, k: K) => page.evaluate((key) => (window as unknown as { game: () => G }).game()[key], k) as Promise<G[K]>;

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

export const visible = (page: Page, sel: string) =>
  page.evaluate((s) => { const e = document.querySelector(s) as HTMLElement | null; return !!e && !e.hidden && getComputedStyle(e).display !== "none"; }, sel);

/** Open the start page with a fixed track and wait for the start card. */
export async function open(page: Page, query = "seed=7"): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.locator("#overlay")).toBeVisible();
}

export async function startRun(page: Page): Promise<void> {
  await page.click("#play");
  await expect(page.locator("#overlay")).toBeHidden();
  await expect.poll(() => g(page, "tick")).toBeGreaterThan(10);
}

/** End the run now, as a head-on crash. */
export const crash = (page: Page) => page.evaluate(() => { const x = (window as unknown as { game: () => { dead: boolean; deathCause: string } }).game(); x.dead = true; x.deathCause = "train front"; });

/** A swipe on the game canvas (pointer events, as a finger makes them). */
export async function swipe(page: Page, dx: number, dy: number, selector = "canvas"): Promise<void> {
  await page.evaluate(({ dx, dy, selector }) => {
    const c = document.querySelector(selector) as HTMLElement;
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const ev = (type: string, cx: number, cy: number) => c.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, pointerType: "touch", bubbles: true }));
    ev("pointerdown", x, y);
    ev("pointerup", x + dx, y + dy);
  }, { dx, dy, selector });
}

/** Record the highest point and whether a roll happened, tick by tick (the browser may run many ticks
 *  between two samples, so a whole jump can fit between them). Read with seen(). */
export const recordMoves = (page: Page) => page.evaluate(() => {
  const x = (window as unknown as { game: () => Record<string, unknown> & { step: (a: number) => void; y: number; rolling: boolean } }).game();
  const step = x.step.bind(x);
  x.__maxY = 0; x.__rolled = false;
  x.step = (a: number) => { step(a); x.__maxY = Math.max(x.__maxY as number, x.y); if (x.rolling) x.__rolled = true; };
});
export const seen = (page: Page) => page.evaluate(() => {
  const x = (window as unknown as { game: () => { __maxY: number; __rolled: boolean } }).game();
  return { maxY: x.__maxY, rolled: x.__rolled };
});
