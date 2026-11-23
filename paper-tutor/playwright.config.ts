import { defineConfig, devices } from "@playwright/test";

// End-to-end user stories (USER_STORIES.md): desktop Chromium and iPhone WebKit, voice on, with every API stubbed
// from e2e/fixtures (no AI, no voice spend). By default it starts its own fresh dev server on port 3210, so a
// stale dev server can never be tested by mistake. PT_E2E_REUSE=1 runs against the dev server already on :3200.
const reuse = process.env.PT_E2E_REUSE === "1";
const port = reuse ? 3200 : 3210;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  workers: 2, // keep the machine responsive
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
      grepInvert: /@landscape|@phone-only/,
    },
    { name: "iphone", use: { ...devices["iPhone 13"] }, grepInvert: /@landscape|@desktop-only/ },
    { name: "iphone-landscape", use: { ...devices["iPhone 13 landscape"] }, grep: /@landscape/, grepInvert: /@desktop-only/ },
  ],
  webServer: {
    command: `npx next dev --port ${port}`,
    url: `http://localhost:${port}`,
    env: { PT_DIST_DIR: ".next-e2e" },
    reuseExistingServer: reuse,
    timeout: 120_000,
  },
});
