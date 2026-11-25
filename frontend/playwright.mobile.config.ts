import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: /standalone-crawl\.spec\.ts/,
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.OMH_WEB_URL ?? "http://localhost:3420",
    trace: "retain-on-failure",
  },
});
