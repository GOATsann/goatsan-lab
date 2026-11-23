// End-to-end tests of the real game in real browsers (USER_STORIES.md is the spec).
//   npm run build && npx playwright test          (serves dist/ with vite preview on port 5191)
//   npx playwright test --project=iphone           one device
// Needs the AI models in public/models/ (node test/e2e/fetch-models.mjs). The character models, sounds and music
// are not in the public repo; the game falls back to stand-in robots and silence, which the tests accept.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // one game at a time: each one runs a 3D scene and the AI
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:5191", trace: "retain-on-failure" },
  webServer: { command: "npx vite preview --port 5191 --strictPort", url: "http://localhost:5191", reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    // Safari and Chrome on iPhone are both WebKit (no Pointer Lock API: the cause of past tap bugs)
    { name: "iphone", use: { ...devices["iPhone 13 landscape"] } },
    { name: "android", use: { ...devices["Pixel 7 landscape"] } },
  ],
});
