import { expect, test } from "@playwright/test";
import { audioAdvances, control, isPhone, openPaper, player, press, showControls, startPlaying } from "./helpers";

// Player controls in every state (USER_STORIES.md, P stories).

test("P01 play from the start: board draws and the voice plays", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  const s = await player(page);
  expect(s.playing).toBe(true);
  expect(s.audio?.muted).toBe(false);
  expect(await audioAdvances(page)).toBe(true);
});

test("P02 pause mid-sentence freezes board and voice; play resumes from the same place", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await page.waitForTimeout(800);
  await control(page, "Pause");
  const a = await player(page);
  expect(a.playing).toBe(false);
  expect(a.audio?.paused).toBe(true);
  await page.waitForTimeout(800);
  const b = await player(page);
  expect(b.time).toBeCloseTo(a.time, 2);
  await control(page, "Play");
  await expect.poll(async () => (await player(page)).audio?.paused).toBe(false);
  const c = await player(page);
  expect(c.scene).toBe(a.scene);
  expect(c.audio!.currentTime).toBeGreaterThanOrEqual(a.audio!.currentTime - 0.05);
  expect(await audioAdvances(page)).toBe(true);
});

test("P03 next and previous scene while playing", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Next scene");
  await expect.poll(async () => (await player(page)).scene).toBe(1);
  await expect.poll(async () => (await player(page)).audio?.paused, { timeout: 10_000 }).toBe(false);
  await control(page, "Next scene");
  await expect.poll(async () => (await player(page)).scene).toBe(2);
  await page.waitForTimeout(300);
  await control(page, "Previous scene"); // early in a scene: goes to the scene before
  await expect.poll(async () => (await player(page)).scene).toBe(1);
  expect((await player(page)).playing).toBe(true);
});

test("P04 tapping a scene segment jumps there, playing or paused", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await showControls(page);
  await press(page, '.pbar-seg[aria-label="Scene 3"]');
  await expect.poll(async () => (await player(page)).scene).toBe(2);
  await control(page, "Pause");
  await showControls(page);
  await press(page, '.pbar-seg[aria-label="Scene 2"]');
  await expect.poll(async () => (await player(page)).scene).toBe(1);
  expect((await player(page)).playing).toBe(false);
});

test("P05 mute mid-sentence then unmute: the same sentence's voice comes back at once (bug)", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await page.waitForTimeout(500);
  await control(page, "Mute the voice");
  const muted = await player(page);
  expect(muted.audio?.muted).toBe(true);
  expect(muted.voice).toBe(false);
  expect(await audioAdvances(page, 500)).toBe(true); // it keeps its place, silently
  await control(page, "Turn the voice on");
  const back = await player(page);
  expect(back.audio?.muted).toBe(false);
  expect(back.audio?.paused).toBe(false);
  expect(back.scene).toBe(muted.scene);
  expect(back.audio?.sentence).toBe(muted.audio?.sentence); // not waiting for the next sentence or scene
  expect(await audioAdvances(page)).toBe(true);
});

test("P06 unmute in a sentence that started muted: its voice joins mid-sentence", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Mute the voice");
  await control(page, "Next scene"); // a new scene starts while muted: silent sentences
  await expect.poll(async () => (await player(page)).scene).toBe(1);
  await expect.poll(async () => (await player(page)).audio?.sentence ?? -1).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(600);
  const before = await player(page);
  expect(before.audio?.voicedSentence).toBe(-1);
  await control(page, "Turn the voice on");
  await expect
    .poll(async () => {
      const s = await player(page);
      return s.audio?.voicedSentence === s.audio?.sentence && !s.audio?.paused && !s.audio?.muted;
    }, { timeout: 5_000 })
    .toBe(true);
  expect(await audioAdvances(page)).toBe(true);
});

test("P07 speed change mid-sentence applies at once", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Settings");
  await press(page, '.seg[aria-label="Speed"] button:has-text("1.5×")');
  const s = await player(page);
  expect(s.speed).toBe(1.5);
  expect(s.audio?.playbackRate).toBe(1.5);
  expect(s.audio?.paused).toBe(false);
});

test("P08 mute and unmute while paused stay paused", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Pause");
  await control(page, "Mute the voice");
  await control(page, "Turn the voice on");
  const s = await player(page);
  expect(s.playing).toBe(false);
  expect(s.audio?.paused).toBe(true);
  expect(s.audio?.muted).toBe(false);
});

test("P09 at the end it stops; play starts again from the beginning", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Settings");
  await press(page, '.seg[aria-label="Speed"] button:has-text("1.5×")');
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await showControls(page);
  await press(page, '.pbar-seg[aria-label="Scene 4"]');
  await expect.poll(async () => (await player(page)).ended, { timeout: 30_000 }).toBe(true);
  expect((await player(page)).audio?.paused).toBe(true);
  await control(page, "Play");
  await expect.poll(async () => (await player(page)).scene).toBe(0);
  expect((await player(page)).playing).toBe(true);
});

test("P10 style change mid-play keeps playing", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Settings");
  await press(page, '.seg[aria-label="Style"] button:has-text("Chalkboard")');
  await expect(page.locator(".player.theme-chalkboard")).toHaveCount(1);
  expect((await player(page)).playing).toBe(true);
});

test("P11 settings: choices apply without closing; closes on outside tap; no Done button", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Settings");
  await expect(page.locator(".settings")).toBeVisible();
  await expect(page.locator(".settings-done")).toHaveCount(0);
  await press(page, '.seg[aria-label="Voice"] button:has-text("Off")');
  await expect(page.locator(".settings")).toBeVisible();
  if (isPhone(page)) {
    await page.locator(".settings-backdrop").click({ position: { x: 100, y: 40 } });
  } else {
    await page.mouse.click(20, 450);
  }
  await expect(page.locator(".settings")).toHaveCount(0);
});

test("P12 settings closes with Esc on desktop @desktop-only", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Settings");
  await expect(page.locator(".settings-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings")).toHaveCount(0);
});

test("P13 phone settings sheet closes with its X @phone-only", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Settings");
  await expect(page.locator(".settings-sheet")).toBeVisible();
  await page.locator(".sheet-close").tap();
  await expect(page.locator(".settings")).toHaveCount(0);
});

test("P14 full screen: only the player shows; exit brings the page back", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Full screen");
  await expect(page.locator("html.pt-fullscreen")).toHaveCount(1);
  for (const sel of [".ask-dock", ".side-tabs", ".acct"]) await expect(page.locator(sel).first()).toBeHidden();
  expect((await player(page)).playing).toBe(true);
  await control(page, "Exit full screen");
  await expect(page.locator("html.pt-fullscreen")).toHaveCount(0);
  await expect(page.locator(".ask-dock")).toBeVisible();
});

test("P15 settings open inside full screen (bug)", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Full screen");
  await control(page, "Settings");
  const box = page.locator(".settings");
  await expect(box).toBeVisible();
  // visible on top: the topmost element at its centre is inside it
  await page.waitForTimeout(400); // let it finish sliding up
  const onTop = await box.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && el.contains(top) ? "ok" : `covered by ${top?.tagName}.${(top as HTMLElement)?.className} at ${Math.round(r.top)}/${Math.round(r.height)} in ${innerHeight}`;
  });
  expect(onTop).toBe("ok");
  await press(page, '.seg[aria-label="Speed"] button:has-text("1.25×")');
  expect((await player(page)).speed).toBe(1.25);
});

test("P16 Ask from full screen leaves full screen and focuses the question box", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Full screen");
  await control(page, "Ask a question");
  await expect(page.locator("html.pt-fullscreen")).toHaveCount(0);
  await expect(page.locator("#ask-q")).toBeFocused();
  expect((await player(page)).playing).toBe(true);
});

test("P17 controls hide while playing and come back on tap or hover", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await expect(page.locator(".player-stage.controls-off")).toHaveCount(1, { timeout: 6_000 });
  await showControls(page);
  await control(page, "Pause");
  await page.waitForTimeout(3000);
  await expect(page.locator(".player-stage.controls-on")).toHaveCount(1); // stay while paused
});

test("P18 phone: the full player stays pinned at the top while scrolling, with no gap @phone-only", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    const slot = document.querySelector(".stage-slot")!.getBoundingClientRect();
    const board = document.querySelector(".board")!.getBoundingClientRect();
    return { slotTop: slot.top, slotH: slot.height, boardH: board.height, boardW: board.width };
  });
  expect(g.slotTop).toBeLessThanOrEqual(1);
  expect(g.slotH - g.boardH).toBeLessThan(16); // just the board (plus a little padding)
  expect(Math.abs(g.boardW / g.boardH - 16 / 9)).toBeLessThan(0.02);
  expect((await player(page)).playing).toBe(true);
});

test("P19 phone sideways: the board fits the screen height @landscape", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  const g = await page.evaluate(() => ({ boardH: document.querySelector(".board")!.getBoundingClientRect().height, vh: window.innerHeight }));
  expect(g.boardH).toBeLessThanOrEqual(g.vh);
  await control(page, "Full screen");
  await control(page, "Settings");
  await expect(page.locator(".settings")).toBeVisible();
});

test("P20 keyboard on desktop: space pauses, arrows skip, v mutes @desktop-only", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await page.locator(".player").focus();
  await page.keyboard.press("Space");
  expect((await player(page)).playing).toBe(false);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await player(page)).scene).toBe(1);
  await page.keyboard.press("v");
  expect((await player(page)).voice).toBe(false);
});
