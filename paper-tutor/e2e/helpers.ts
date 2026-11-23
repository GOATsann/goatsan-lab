import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, type Route } from "@playwright/test";
import { answerScenes, deepDiveScenes, ingest, meta, overview, PAPER_ID, structure } from "./fixtures/paper";

const VOICE = readFileSync(path.join(__dirname, "fixtures/voice.mp3"));
const FIGURE = readFileSync(path.join(__dirname, "fixtures/figure.png"));

export const PAPER_URL = `/paper/${PAPER_ID}`;

export type StubOptions = { signedIn?: boolean; chatLimit?: boolean };
export type Calls = { chat: Record<string, unknown>[]; tts: number; signIn: number };

const ndjson = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// Every API the paper page uses, answered from the fixtures. Voice is a short local tone (no spend).
export async function stubApp(page: Page, opts: StubOptions = {}): Promise<Calls> {
  const calls: Calls = { chat: [], tts: 0, signIn: 0 };
  const signedIn = opts.signedIn ?? true;
  await page.route("**/api/me", (r) => json(r, { user: signedIn ? { id: "user_e2e", email: "e2e@example.com", name: "E2E" } : null, auth: true }));
  await page.route("**/api/tts", (r) => {
    calls.tts++;
    return r.fulfill({ status: 200, contentType: "audio/mpeg", body: VOICE });
  });
  await page.route(`**/api/papers/${PAPER_ID}/figures/**`, (r) => r.fulfill({ status: 200, contentType: "image/png", body: FIGURE }));
  await page.route(`**/api/papers/${PAPER_ID}/overview`, (r) =>
    r.request().method() === "GET"
      ? json(r, { overview })
      : r.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson([{ meta: { theme: "diagram", cached: true } }, ...overview.scenes.map((scene) => ({ scene })), { done: true }]) }),
  );
  await page.route(`**/api/papers/${PAPER_ID}/tutor`, (r) =>
    r.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson([{ meta: { theme: "diagram", cached: true } }, ...deepDiveScenes.map((scene) => ({ scene })), { done: true }]) }),
  );
  await page.route(`**/api/papers/${PAPER_ID}/chat`, async (r) => {
    const body = r.request().postDataJSON() as { question: string; video: boolean };
    calls.chat.push(body);
    if (opts.chatLimit) return json(r, { error: "You've used today's 50 chat messages. The limit resets at midnight UTC." }, 429);
    if (/^(hello|hi|thanks)\b/i.test(body.question)) {
      return r.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson([{ text: "Hello! Ask me anything about this paper." }, { done: true }]) });
    }
    const lines: unknown[] = [{ text: "The tests press every control and check the result [[method]]." }];
    if (body.video) lines.push({ video: true }, ...answerScenes.map((scene) => ({ scene })));
    lines.push({ done: true });
    // A little delay, like the real thing, so "mid-play" stays mid-play.
    await new Promise((res) => setTimeout(res, 400));
    return r.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson(lines) });
  });
  await page.route(`**/api/papers/${PAPER_ID}`, (r) => json(r, { meta, ingest, structure }));
  await page.route(`**/api/papers/${PAPER_ID}/ingest`, (r) => json(r, { ingest }));
  await page.route("**/auth/signin**", (r) => {
    calls.signIn++;
    return r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Sign in</h1>" });
  });
  return calls;
}

export type PlayerState = {
  scene: number;
  scenes: number;
  playing: boolean;
  ended: boolean;
  time: number;
  speed: number;
  voice: boolean;
  label: string | null;
  audio: { hasSource: boolean; muted: boolean; paused: boolean; currentTime: number; playbackRate: number; sentence: number; voicedSentence: number } | null;
};

export async function player(page: Page): Promise<PlayerState> {
  return page.evaluate(() => {
    const e = (window as unknown as { __ptEngine?: any }).__ptEngine;
    return {
      scene: e.sceneIndex,
      scenes: e.list.scenes.length,
      playing: e.playing,
      ended: e.ended,
      time: e.time,
      speed: e.speed,
      voice: e.voice,
      label: document.querySelector(".board-label span")?.textContent ?? null,
      audio: e.audioState(),
    };
  });
}

// Open the test paper with a clean history, voice on.
export async function openPaper(page: Page, opts: StubOptions = {}) {
  const calls = await stubApp(page, opts);
  // A clean history once per test (a reload inside the test keeps it).
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem("pt-e2e")) return;
      sessionStorage.setItem("pt-e2e", "1");
      for (const k of Object.keys(localStorage)) if (k.startsWith("pt-history")) localStorage.removeItem(k);
      localStorage.setItem("pt-voice", "on");
    } catch {}
  });
  await page.goto(`${PAPER_URL}?voice=on`);
  // The Next.js dev-tools badge isn't part of the app; keep it from catching taps in tests.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.locator(".big-play")).toBeVisible();
  await expect(page.locator(".big-play")).toHaveAttribute("aria-label", "Play the overview");
  return calls;
}

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 600;

// Tap on touch devices, click elsewhere.
export async function press(page: Page, selector: string) {
  if (isPhone(page)) await page.locator(selector).first().tap();
  else await page.locator(selector).first().click();
}

// The controls hide while playing: bring them back first.
export async function showControls(page: Page) {
  const on = await page.locator(".player-stage.controls-on").count();
  if (on) return;
  if (isPhone(page)) await page.locator(".board").tap({ position: { x: 40, y: 40 } });
  else await page.locator(".board").hover({ position: { x: 60, y: 60 } });
  await expect(page.locator(".player-stage.controls-on")).toHaveCount(1);
}

export async function control(page: Page, label: string) {
  await showControls(page);
  await press(page, `.pbtn[aria-label="${label}"]`);
}

// Start the overview and wait until a voiced sentence is playing.
export async function startPlaying(page: Page) {
  await press(page, ".big-play");
  await expect.poll(async () => (await player(page)).audio?.hasSource && !(await player(page)).audio?.paused, { timeout: 10_000 }).toBe(true);
}

export async function audioAdvances(page: Page, ms = 700): Promise<boolean> {
  const a = (await player(page)).audio?.currentTime ?? 0;
  await page.waitForTimeout(ms);
  const b = (await player(page)).audio?.currentTime ?? 0;
  return b > a + 0.1;
}
