import { expect, test, type Page } from "@playwright/test";
import { control, openPaper, player, press, showControls, startPlaying } from "./helpers";

// Exploratory sweep (run with: npx playwright test explore --project=iphone): in each state, every visible
// control must be on screen and the topmost thing where a finger would land. Problems are printed and fail it.

async function reachable(page: Page, where: string): Promise<string[]> {
  return page.evaluate((where) => {
    const out: string[] = [];
    const vw = innerWidth;
    const vh = innerHeight;
    const sel = ".pbar button, .board-label button, .board-action, .big-play, .ask button, .ask textarea, .side-tabs button, .settings button, .lightbox-close";
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.closest(".controls-off .pbar")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 24) || el.className;
      // only things inside the viewport count; the rest scroll into view
      if (r.bottom < 0 || r.top > vh) continue;
      if (r.left < -1 || r.right > vw + 1) out.push(`${where}: "${name}" is cut off at the side`);
      const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      const modal = document.querySelector(".settings-backdrop, .lightbox");
      if (modal && !modal.contains(el)) continue; // behind an open sheet or popup, on purpose
      if (top && !el.contains(top) && !top.contains(el)) {
        const by = (top as HTMLElement).className || top.tagName;
        out.push(`${where}: "${name}" is covered by ${String(by).slice(0, 40)}`);
      }
      if (r.height < 28 && el.closest(".pbar")) out.push(`${where}: "${name}" is only ${Math.round(r.height)}px tall`);
    }
    return out;
  }, where);
}

test("X01 phone sweep: every control reachable in every state @phone-only", async ({ page }) => {
  const issues: string[] = [];
  await openPaper(page);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  issues.push(...(await reachable(page, "idle")));
  await startPlaying(page);
  await showControls(page);
  issues.push(...(await reachable(page, "playing")));
  await control(page, "Pause");
  issues.push(...(await reachable(page, "paused")));
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(300);
  await showControls(page);
  issues.push(...(await reachable(page, "pinned")));
  await control(page, "Settings");
  issues.push(...(await reachable(page, "settings sheet")));
  await page.locator(".sheet-close").tap();
  await control(page, "Full screen");
  await showControls(page);
  issues.push(...(await reachable(page, "full screen")));
  await control(page, "Settings");
  issues.push(...(await reachable(page, "full screen settings")));
  await page.locator(".sheet-close").tap();
  await control(page, "Exit full screen");
  // a video answer, then Resume
  await control(page, "Play");
  await page.locator('.answer-mode button:has-text("As video")').tap();
  await page.fill("#ask-q", "How do the tests work?");
  await page.locator(".ask button[type=submit]").tap();
  await expect(page.locator(".board-action")).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  issues.push(...(await reachable(page, "answer ended (Resume)")));
  await press(page, ".board-action");
  expect((await player(page)).label).toBe("Overview");
  // Sections and a figure
  await page.locator('.side-tabs button:has-text("Sections")').tap();
  await page.locator("#sec-method .outline-head").tap();
  issues.push(...(await reachable(page, "sections open")));
  await page.locator("#sec-method .figure-open").tap();
  issues.push(...(await reachable(page, "figure popup")));
  await page.locator(".lightbox-close").tap();
  console.log(issues.length ? `ISSUES:\n${issues.join("\n")}` : "no issues");
  expect(issues).toEqual([]);
});
