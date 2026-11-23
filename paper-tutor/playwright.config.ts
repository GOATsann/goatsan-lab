import { defineConfig, devices } from "@playwright/test";

// End-to-end user stories (USER_STORIES.md): desktop Chromium and iPhone WebKit, voice on, with every API stubbed
// from e2e/fixtures (no AI, no voice spend). Runs against the dev server on port 3200 (started if not running).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  workers: 2, // keep the machine responsive
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3200",
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
    command: "npm run dev",
    url: "http://localhost:3200",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
