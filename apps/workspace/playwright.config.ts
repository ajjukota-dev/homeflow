import { defineConfig } from "@playwright/test";

/**
 * Workspace visual checks at the three breakpoints CLAUDE.md requires
 * (1440 / 768 / 375). Runs against the Vite dev server, which proxies /api and
 * /auth to the compose stack on :8001 so the session cookie is same-origin.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WORKSPACE_URL ?? "http://localhost:5173",
    ignoreHTTPSErrors: true,
  },
});
