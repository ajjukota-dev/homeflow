import { defineConfig } from "@playwright/test";

// Customer portal visual checks. Assumes dev server already running on :5174.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5174",
    storageState: "e2e/.auth/superadmin.json",
  },
});
