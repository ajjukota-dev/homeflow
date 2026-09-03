import { defineConfig } from "@playwright/test";

// Customer portal visual checks. Assumes dev server already running on :5174.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:5174" },
});
