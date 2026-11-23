import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingest as fixtureIngest, overview } from "./fixtures/paper";
import { player } from "./helpers";

// Opening a paper from a link, with the server's live progress: a fake upload whose download, page reading,
// figures, map and overview advance on every poll. No AI, no spend.

const ID = "up_e2eLoading01";
const TITLE = "GR00T 2: Scaling Robot Foundation Models for Generalization, Dexterity, and Adaptation";
const FILE_NAME = "gr00t2 whitepaper";
const VOICE = readFileSync(path.join(__dirname, "fixtures/voice.mp3"));

type StepState = "waiting" | "active" | "done";
const steps = (s: [StepState, string?][]) =>
  ["download", "pages", "figures", "map", "overview"].map((key, i) => ({
    key,
    label: ["Downloading", "Reading pages", "Finding figures", "Mapping the paper", "Writing the overview"][i],
    state: s[i][0],
    detail: s[i][1],
  }));
// One frame per poll.
const FRAMES = [
  steps([["active", "3.1 / 22.4 MB"], ["waiting"], ["waiting"], ["waiting"], ["waiting"]]),
  steps([["active", "14.0 / 22.4 MB"], ["waiting"], ["waiting"], ["waiting"], ["waiting"]]),
  steps([["done", "22.4 MB"], ["active", "61 / 135"], ["waiting"], ["waiting"], ["waiting"]]),
  steps([["done", "22.4 MB"], ["done", "135 pages"], ["active", "12 found"], ["active", "a first sketch"], ["active", "the opening"]]),
];

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const ndjson = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

async function stubOpening(page: Page, opts: { failDownload?: boolean; overviewDelay?: number } = {}) {
  let polls = 0;
  let downloaded = false;
  let ingested = false;
  const meta = () => ({
    id: ID,
    source: "upload",
    owner: "user_e2e",
    title: downloaded ? TITLE : "",
    authors: [],
    abstract: "",
    ...(downloaded ? { pages: 135 } : { pending: true }),
    ...(opts.failDownload && polls >= 2 ? { pending: false, error: "That link didn't return a PDF." } : {}),
  });
  const ingest = { ...fixtureIngest, id: ID, figures: [] };
  await page.route("**/api/me", (r) => json(r, { user: { id: "user_e2e", email: "e2e@example.com", name: "E2E" }, auth: true }));
  await page.route("**/api/tts", (r) => r.fulfill({ status: 200, contentType: "audio/mpeg", body: VOICE }));
  await page.route(`**/api/papers/${ID}/progress`, (r) => {
    const frame = FRAMES[Math.min(polls++, FRAMES.length - 1)];
    if (polls >= 3 && !opts.failDownload) downloaded = true;
    return json(r, { progress: { steps: frame, ...(opts.failDownload && polls >= 2 ? { error: "That link didn't return a PDF." } : {}), updatedAt: Date.now() } });
  });
  await page.route(`**/api/papers/${ID}`, (r) => json(r, { meta: meta(), ingest: ingested ? ingest : null, structure: null }));
  await page.route(`**/api/papers/${ID}/ingest`, async (r) => {
    await new Promise((res) => setTimeout(res, 600));
    ingested = true;
    return json(r, { ingest });
  });
  await page.route(`**/api/papers/${ID}/overview`, async (r) => {
    if (r.request().method() === "GET") return json(r, { overview: null });
    await new Promise((res) => setTimeout(res, opts.overviewDelay ?? 2500));
    const opener = { say: "Groot 2. Here is the idea in about a minute.", draw: [{ t: "title", text: TITLE, y: 260, size: 64, s: 0 }] };
    return r.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson([{ meta: { theme: "diagram", cached: false } }, { scene: opener }, ...overview.scenes.slice(1).map((scene) => ({ scene })), { done: true }]),
    });
  });
}

async function open(page: Page) {
  await page.goto(`/paper/${ID}?voice=on`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

test("L01 opening a link: live steps, the real title, never the file name", async ({ page }, info) => {
  await stubOpening(page);
  await open(page);
  const card = page.locator(".progress-card");
  await expect(card).toBeVisible();
  // Before the download is done: a neutral card, never the file name.
  await expect(card.locator(".progress-title")).toHaveText("Reading the paper…");
  await expect(page.locator(".paper-title")).toHaveText("Reading the paper…");
  await expect(card.locator(".pstep.is-active .pstep-detail").first()).toContainText("MB");
  await page.screenshot({ path: info.outputPath("downloading.png") });
  await expect(page.locator("body")).not.toContainText(FILE_NAME);
  // Counts move on as the server works.
  await expect(card.locator('.pstep:has-text("Reading pages") .pstep-detail')).toHaveText(/\/ 135|135 pages/, { timeout: 8000 });
  // The real title, from page 1, as soon as the download is in.
  await expect(page.locator(".paper-title")).toHaveText(TITLE, { timeout: 8000 });
  await expect(card.locator(".progress-title")).toHaveText(TITLE);
  await expect(card.locator('.pstep:has-text("Writing the overview")')).toHaveClass(/is-active/, { timeout: 8000 });
  await page.screenshot({ path: info.outputPath("loading.png") });
  // Every step is on screen, nothing overflows the frame (phone too).
  const frame = await page.locator(".frame").boundingBox();
  for (const s of await card.locator(".pstep").all()) {
    const b = (await s.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(frame!.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(frame!.y + frame!.height + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The overview arrives: the card goes, the board can play.
  await expect(card).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText(FILE_NAME);
});

test("L02 play the opening from the loading card", async ({ page }) => {
  await stubOpening(page, { overviewDelay: 6000 });
  await open(page);
  const play = page.locator(".progress-play");
  await expect(play).toBeVisible({ timeout: 10_000 });
  if ((page.viewportSize()?.width ?? 1000) < 600) await play.tap();
  else await play.click();
  await expect.poll(async () => (await player(page)).playing, { timeout: 10_000 }).toBe(true);
  await expect(page.locator(".progress-card")).toHaveCount(0);
});

test("L03 a link that fails shows why", async ({ page }) => {
  await stubOpening(page, { failDownload: true });
  await open(page);
  await expect(page.getByText("That link didn't return a PDF.").first()).toBeVisible({ timeout: 8000 });
});

test("T07 fresh open: the opening scene shows as soon as the overview stream starts", async ({ page }) => {
  await stubOpening(page, { overviewDelay: 1200 });
  await open(page);
  await expect(page.locator(".progress-card")).toHaveCount(0, { timeout: 12_000 });
  const t = await page.evaluate(() => (window as unknown as { __ptTimes?: { firstScene?: number; secondScene?: number; done?: number } }).__ptTimes);
  // The stub answers after 1.2 s; the page adds almost nothing on top.
  expect(t?.firstScene).toBeLessThan(2500);
  expect(t?.done).toBeLessThan(3000);
  await expect(page.locator(".board")).toContainText("GR00T 2");
});
