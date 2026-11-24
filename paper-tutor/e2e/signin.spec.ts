import { expect, test, type Page } from "@playwright/test";
import { openPaper } from "./helpers";

// A04b: going to sign-in shows a pending state at once ("Opening sign-in…"), a second tap does nothing, and coming
// back with the back button clears it. Sign-in itself is stubbed and slowed down, like the real redirects.

async function slowSignIn(page: Page) {
  let hits = 0;
  await page.route("**/auth/signin**", async (r) => {
    hits++;
    await new Promise((res) => setTimeout(res, 2500));
    await r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Sign in</h1>" });
  });
  return () => hits;
}

// Everything is checked inside the page, in the moments after the tap: once the browser is leaving for sign-in,
// Playwright can't query the old page any more (and its own click would wait for the navigation to finish).
type Seen = { pendingMs: number | null; pill: boolean; btnText: string; btnDisabled: string | null };
async function tapAndLook(page: Page, selector: string, opts: { twice?: boolean; backFromCache?: boolean } = {}): Promise<Seen> {
  return page.evaluate(
    async ({ sel, twice, backFromCache }) => {
      let pendingAt: number | null = null;
      const obs = new MutationObserver(() => {
        if (pendingAt === null && document.querySelector(".signin-pending")) pendingAt = performance.now();
      });
      obs.observe(document.body, { childList: true, subtree: true });
      const el = document.querySelector(sel) as HTMLElement;
      const t0 = performance.now();
      el.click();
      if (twice) el.click();
      await new Promise((r) => setTimeout(r, 60));
      if (backFromCache) {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        await new Promise((r) => setTimeout(r, 60));
      }
      obs.disconnect();
      const btn = document.querySelector(".acct-signin");
      return {
        pendingMs: pendingAt === null ? null : pendingAt - t0,
        pill: Boolean(document.querySelector(".signin-pending")),
        btnText: btn?.textContent ?? "",
        btnDisabled: btn?.getAttribute("aria-disabled") ?? null,
      };
    },
    { sel: selector, twice: Boolean(opts.twice), backFromCache: Boolean(opts.backFromCache) },
  );
}

test("A04b account button: pending within 100 ms, disabled, one navigation for a double tap", async ({ page }) => {
  await openPaper(page, { signedIn: false });
  const hits = await slowSignIn(page);
  await expect(page.locator(".acct-signin")).toHaveText("Sign in");
  const seen = await tapAndLook(page, ".acct-signin", { twice: true });
  expect(seen.pendingMs).not.toBeNull();
  expect(seen.pendingMs!).toBeLessThan(100);
  expect(seen.pill).toBe(true);
  expect(seen.btnText).toBe("Opening sign-in…");
  expect(seen.btnDisabled).toBe("true");
  await page.waitForURL(/auth\/signin/, { timeout: 8000 });
  expect(hits()).toBe(1);
});

test("A04b play the overview signed out: the same pending state", async ({ page }) => {
  await openPaper(page, { signedIn: false });
  // Nobody has made this overview yet (registered after the shared stubs, so it wins), then reload.
  await page.route("**/api/papers/2401.00001/overview", (r) =>
    r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ overview: null }) }) : r.fallback(),
  );
  await page.reload();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.locator(".overview-note")).toContainText("Sign in to play it first");
  await slowSignIn(page);
  const seen = await tapAndLook(page, ".big-play");
  expect(seen.pendingMs).not.toBeNull();
  expect(seen.pendingMs!).toBeLessThan(100);
  expect(seen.pill).toBe(true);
});

test("A04b back from sign-in (page restored from the back/forward cache): the pending state is cleared", async ({ page }) => {
  await openPaper(page, { signedIn: false });
  await slowSignIn(page);
  const seen = await tapAndLook(page, ".acct-signin", { backFromCache: true });
  expect(seen.pendingMs).not.toBeNull();
  expect(seen.pill).toBe(false);
  expect(seen.btnText).toBe("Sign in");
});
