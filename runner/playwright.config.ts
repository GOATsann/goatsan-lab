// End-to-end tests of Lights-Out Surfer in real browsers (USER_STORIES.md is the spec).
//   npm run build && npx playwright test          (serves dist/ with vite preview on port 5181)
// The leaderboard API lives on the personal site; the tests mock it (http://localhost:3100).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:5181", trace: "retain-on-failure" },
  webServer: { command: "npx vite preview --port 5181 --strictPort", url: "http://localhost:5181", reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    { name: "iphone", use: { ...devices["iPhone 13"] } }, // portrait: the runner is played upright
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
});
