import { defineConfig } from "@playwright/test";

// Visual/E2E config. Assumes the dev server is already running on :5173
// (started separately so it stays up across slices).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
  },
});
