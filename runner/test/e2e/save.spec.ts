// Save score, sign-in hand-off and the leaderboard, against a mocked personal-site API (LS-062..LS-084).
// The real API is on www.theonlygoatsan.com; locally the game calls http://localhost:3100.
import { expect, test, type Page } from "@playwright/test";
import { crash, open, startRun } from "./game";

type Mock = { signedIn: boolean; posts: Record<string, unknown>[]; signins: string[]; board: number[]; boardFails: boolean };

async function mockApi(page: Page, m: Mock): Promise<void> {
  await page.route("http://localhost:3100/**", async (route) => {
    const u = new URL(route.request().url());
    const cors = { "Access-Control-Allow-Origin": "http://localhost:5181", "Access-Control-Allow-Credentials": "true" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" } });
    if (u.pathname === "/api/surfer/score") {
      m.posts.push(JSON.parse(route.request().postData() || "{}"));
      if (!m.signedIn) return route.fulfill({ status: 401, headers: cors, contentType: "application/json", body: '{"error":"sign in first"}' });
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ score: 321, level: 1, best: 321, rank: 4, improved: true }) });
    }
    if (u.pathname === "/api/surfer/leaderboard") {
      const level = Number(u.searchParams.get("level"));
      m.board.push(level);
      if (m.boardFails) return route.fulfill({ status: 500, headers: cors, body: "" });
      const top = level === 2 ? [] : [{ rank: 1, name: "Ike", score: 9001, seconds: 600, at: "2026-11-16" },
        { rank: 2, name: "<img src=x onerror=alert(1)>", score: 500, seconds: 60, at: "2026-11-16" }];
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ level, top, me: m.signedIn ? { best: 321, rank: 4 } : null }) });
    }
    if (u.pathname === "/auth/signin") {
      m.signins.push(u.toString());
      m.signedIn = true;
      // a page that sends the browser back (WebKit can't fake a 302 in a test; the real site sends one)
      const back = JSON.stringify(u.searchParams.get("return") ?? "/");
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><script>location.replace(${back})</script>` });
    }
    return route.fulfill({ status: 404, body: "" });
  });
}

const fresh = (): Mock => ({ signedIn: false, posts: [], signins: [], board: [], boardFails: false });

async function endARun(page: Page): Promise<void> {
  await startRun(page);
  await crash(page);
  await expect(page.locator("#overlay")).toBeVisible({ timeout: 6000 });
}

test("LS-062/063: Save shows after a solo run; without a name it asks for one", async ({ page }) => {
  const m = fresh();
  await mockApi(page, m);
  await open(page);
  await page.fill("#name", "");
  await endARun(page);
  await expect(page.locator("#save")).toBeVisible();
  await page.click("#save");
  await expect(page.locator("#saveMsg")).not.toBeEmpty();
  expect(m.posts).toEqual([]); // nothing sent without a name
});

test("LS-064: signed in, Save saves at once", async ({ page }) => {
  const m = { ...fresh(), signedIn: true };
  await mockApi(page, m);
  await open(page);
  await page.fill("#name", "Tester");
  await endARun(page);
  await page.click("#save");
  await expect(page.locator("#saveMsg")).toContainText(/saved|best|rank/i);
  expect(m.posts).toHaveLength(1);
  expect(m.posts[0]).toMatchObject({ name: "Tester" });
});

test("LS-066/067: signed out, Save goes to sign-in and comes back to the game, and the score is saved", async ({ page }) => {
  const m = fresh();
  await mockApi(page, m);
  await open(page);
  await page.fill("#name", "Tester");
  await endARun(page);
  await page.click("#save");
  await page.waitForURL(/localhost:5181/, { timeout: 15_000 });
  await expect(page.locator("#toast")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#toast")).toContainText(/saved|best|rank/i);
  expect(m.signins).toHaveLength(1);
  const back = new URL(new URL(m.signins[0]).searchParams.get("return")!);
  expect(back.host).toBe("localhost:5181"); // back to the game, not the site's home page (user-found bug)
  expect(m.posts.length).toBeGreaterThanOrEqual(2); // 401 first, then the saved retry
  expect(await page.evaluate(() => localStorage.getItem("lights-out:pending-score"))).toBeNull();
});

test("LS-077/078/079/083: the leaderboard opens on the level, shows names as text, switches, closes", async ({ page }) => {
  const m = { ...fresh(), signedIn: true };
  await mockApi(page, m);
  await open(page);
  await page.click('[data-level="1"]');
  await page.click("#boardBtn");
  await expect(page.locator("#board")).toBeVisible();
  await expect(page.locator('[data-board][aria-checked="true"]')).toHaveAttribute("data-board", "1");
  await expect(page.locator("#boardList li")).toHaveCount(2);
  expect(await page.locator("#boardList img").count()).toBe(0); // names are plain text, never HTML
  await expect(page.locator("#boardList")).toContainText("<img");
  await expect(page.locator("#boardMe")).toContainText("321");
  await page.click('[data-board="2"]');
  await expect(page.locator("#boardList .empty")).toBeVisible(); // LS-080: an empty board invites the first score
  await page.click("#boardClose");
  await expect(page.locator("#board")).toBeHidden();
  await expect(page.locator("#overlay")).toBeVisible();
});

test("LS-081/082: a board that can't be reached says so; signed out shows no personal line", async ({ page }) => {
  const m = { ...fresh(), boardFails: true };
  await mockApi(page, m);
  await open(page);
  await page.click("#boardBtn");
  await expect(page.locator("#boardList .empty")).toBeVisible();
  await expect(page.locator("#boardMe")).toBeEmpty();
});
