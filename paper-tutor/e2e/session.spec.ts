import { expect, test } from "@playwright/test";
import { control, isPhone, openPaper, player, press, showControls, startPlaying } from "./helpers";

// Chat, deep dives, explanations, figures, sections, history and sign-in (USER_STORIES.md, C/T/H/A stories).

async function ask(page: import("@playwright/test").Page, q: string, mode: "As video" | "As text" = "As video") {
  await page.locator(`.answer-mode button:has-text("${mode}")`).click();
  await page.fill("#ask-q", q);
  await page.locator(".ask button[type=submit]").click();
}

test("C01 'hello' gets a text reply and the board keeps playing", async ({ page }) => {
  const calls = await openPaper(page);
  await startPlaying(page);
  await ask(page, "hello");
  await expect(page.locator(".history > li").last()).toContainText("Hello!");
  const s = await player(page);
  expect(s.playing).toBe(true);
  expect(s.audio?.paused).toBe(false);
  expect(s.label).toBe("Overview");
  await expect(page.locator(".board-action")).toHaveCount(0);
  expect(calls.chat.at(-1)?.video).toBe(true); // the tool was on offer; the tutor chose text
});

test("C02 a question as video mid-play plays only its answer, then offers Resume, which resumes", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await control(page, "Next scene");
  await expect.poll(async () => (await player(page)).scene).toBe(1);
  await ask(page, "How do the tests work?");
  await expect.poll(async () => (await player(page)).label, { timeout: 10_000 }).toBe("Answering your question");
  // only the answer's scenes, then it stops (never runs on into the overview)
  await expect(page.locator(".board-action")).toHaveText(/Resume overview/, { timeout: 40_000 });
  const stopped = await player(page);
  expect(stopped.playing).toBe(false);
  expect(stopped.label).toBe("Answering your question");
  await press(page, ".board-action");
  await expect.poll(async () => (await player(page)).label).toBe("Overview");
  const resumed = await player(page);
  expect(resumed.playing).toBe(true);
  expect(resumed.scene).toBeGreaterThanOrEqual(1);
  await expect(page.locator(".history > li").last()).toContainText("Played as video");
});

test("C03 'As text' never offers the video tool and doesn't touch the board", async ({ page }) => {
  const calls = await openPaper(page);
  await startPlaying(page);
  await ask(page, "How do the tests work?", "As text");
  await expect(page.locator(".history > li").last()).toContainText("press every control");
  expect(calls.chat.at(-1)?.video).toBe(false);
  expect((await player(page)).label).toBe("Overview");
  expect((await player(page)).playing).toBe(true);
});

test("C04 answers cite their section; a citation opens it in Sections", async ({ page }) => {
  await openPaper(page);
  await ask(page, "How do the tests work?", "As text");
  const chip = page.locator(".history .cite-chip", { hasText: "Method" }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator('.side-tabs button[aria-selected="true"]')).toHaveText("Sections");
  await expect(page.locator("#sec-method.is-open")).toHaveCount(1);
});

test("C05 hitting the chat limit shows a clear message", async ({ page }) => {
  await openPaper(page, { chatLimit: true });
  await ask(page, "How do the tests work?");
  await expect(page.locator(".history .error")).toContainText("limit resets");
});

test("C06 a video answer that interrupts a deep dive offers to resume the deep dive", async ({ page }) => {
  await openPaper(page);
  await page.locator('.side-tabs button:has-text("Sections")').click();
  await page.locator("#sec-method .outline-head").click();
  await page.locator('#sec-method .mini-btn:has-text("Deep dive")').click();
  await expect.poll(async () => (await player(page)).label).toBe("Deep dive: Method");
  await expect.poll(async () => (await player(page)).audio?.paused, { timeout: 10_000 }).toBe(false);
  await ask(page, "Why two steps?");
  await expect(page.locator(".board-action")).toHaveText(/Resume deep dive: Method/, { timeout: 40_000 });
});

test("T01 deep dive from Sections plays on the board; Back returns to the overview", async ({ page }) => {
  await openPaper(page);
  await page.locator('.side-tabs button:has-text("Sections")').click();
  await page.locator("#sec-method .outline-head").click();
  await page.locator('#sec-method .mini-btn:has-text("Deep dive")').click();
  await expect.poll(async () => (await player(page)).label).toBe("Deep dive: Method");
  expect((await player(page)).playing).toBe(true);
  await page.locator(".board-label button").click();
  await expect.poll(async () => (await player(page)).label).toBe("Overview");
});

test("T02 Explain this on an equation plays an explanation", async ({ page }) => {
  await openPaper(page);
  await page.locator('.side-tabs button:has-text("Sections")').click();
  await page.locator("#sec-method .outline-head").click();
  await page.locator('#sec-method .equation .mini-btn:has-text("Explain this")').click();
  await expect.poll(async () => (await player(page)).label).toMatch(/^Explain: /);
  expect((await player(page)).playing).toBe(true);
});

test("T03 figure popup opens and closes with Esc, a tap outside, and X", async ({ page }) => {
  await openPaper(page);
  await page.locator('.side-tabs button:has-text("Sections")').click();
  await page.locator("#sec-method .outline-head").click();
  const fig = page.locator("#sec-method .figure-open");
  await fig.click();
  await expect(page.locator(".lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lightbox")).toHaveCount(0);
  await fig.click();
  const vw = page.viewportSize()!.width;
  await page.locator(".lightbox").click({ position: { x: Math.round(vw / 2), y: 20 } }); // the empty space above the figure
  await expect(page.locator(".lightbox")).toHaveCount(0);
  await fig.click();
  await page.locator(".lightbox-close").click();
  await expect(page.locator(".lightbox")).toHaveCount(0);
});

test("T04 Sections: collapsed outline, filter, and jump links", async ({ page }) => {
  await openPaper(page);
  await page.locator('.side-tabs button:has-text("Sections")').click();
  await expect(page.locator(".outline-item")).toHaveCount(3);
  await expect(page.locator(".outline-item.is-open")).toHaveCount(0);
  await page.fill(".outline-search input", "phones");
  await expect(page.locator(".outline-item")).toHaveCount(1);
  await page.fill(".outline-search input", "");
  await page.locator('.outline-index button:has-text("Results")').click();
  await expect(page.locator("#sec-results.is-open")).toHaveCount(1);
});

test("H01 history: every play and question is a card; tapping replays it", async ({ page }) => {
  await openPaper(page);
  await startPlaying(page);
  await ask(page, "How do the tests work?");
  await expect(page.locator(".play-card", { hasText: "Played as video" })).toBeEnabled({ timeout: 20_000 });
  await page.locator('.side-tabs button:has-text("Sections")').click();
  await page.locator("#sec-method .outline-head").click();
  await page.locator('#sec-method .mini-btn:has-text("Deep dive")').click();
  await page.locator('.side-tabs button:has-text("This session")').click();
  await expect(page.locator(".history .play-card")).toHaveCount(3); // Overview, Played as video, Deep dive
  await page.locator(".play-card", { hasText: "Played as video" }).click();
  await expect.poll(async () => (await player(page)).label).toBe("Answering your question");
  await page.locator(".play-card", { hasText: "Overview" }).click();
  await expect.poll(async () => (await player(page)).label).toBe("Overview");
  await expect.poll(async () => (await player(page)).playing).toBe(true);
});

test("H02 reloading the page keeps the history", async ({ page }) => {
  await openPaper(page);
  await ask(page, "How do the tests work?", "As text");
  await expect(page.locator(".history > li").last()).toContainText("press every control"); // answered
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator(".history > li")).toHaveCount(1);
});

test("A01 signed out: asking or deep diving sends you to sign in", async ({ page }) => {
  const calls = await openPaper(page, { signedIn: false });
  await page.fill("#ask-q", "How do the tests work?");
  await page.locator(".ask button[type=submit]").click();
  await expect.poll(() => calls.signIn).toBe(1);
  await page.goto("/paper/2401.00001?voice=on");
  await page.locator('.side-tabs button:has-text("Sections")').click();
  await page.locator("#sec-method .outline-head").click();
  await page.locator('#sec-method .mini-btn:has-text("Deep dive")').click();
  await expect.poll(() => calls.signIn).toBe(2);
});

test("A02 signed out: the saved overview still plays", async ({ page }) => {
  await openPaper(page, { signedIn: false });
  await startPlaying(page);
  expect((await player(page)).playing).toBe(true);
});

test("M01 phone: the question box stays visible at the bottom while scrolling @phone-only", async ({ page }) => {
  await openPaper(page);
  await page.evaluate(() => window.scrollTo(0, 2000));
  const r = await page.locator("#ask-q").boundingBox();
  const vh = page.viewportSize()!.height;
  expect(r!.y + r!.height).toBeLessThanOrEqual(vh);
  expect(isPhone(page)).toBe(true);
  await showControls(page).catch(() => {});
});
