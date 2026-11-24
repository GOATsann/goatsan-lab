import { defineConfig } from "@playwright/test";

// Unit tests for the AWS store against DynamoDB Local (no browser, no web server, no AWS account).
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
});
