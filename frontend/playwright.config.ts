import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./playwright-output",
  use: {
    baseURL: process.env.OMH_WEB_URL || "http://127.0.0.1:3420",
    reducedMotion: "reduce",
    colorScheme: "dark",
  },
});
