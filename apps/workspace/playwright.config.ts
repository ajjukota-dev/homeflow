import { defineConfig } from "@playwright/test";

// Visual/E2E config. Assumes the dev server is already running on :5173
// (started separately so it stays up across slices).
//
// `design.spec.ts` (spec 32) is the one exception: it only exercises the built @homeflow/ui
// preview pages, not the app itself, so it needs no :5173 server — it points at :5180 (see its
// own `test.use({ baseURL })`) and that static server IS auto-started below. Only one `webServer`
// entry is declared (not two) because attempting to manage both :5173 and :5180 here raced with
// each other unreliably on Windows during development; :5173 keeps the existing manual-start
// convention.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "npm run preview:build && npx vite preview --config preview.vite.config.ts --port 5180 --strictPort",
    cwd: "../../packages/ui",
    // Not "http://localhost:5180" bare: the preview build has no root index.html (only named
    // pages like type.html — see preview.vite.config.ts's PAGES list), so `/` 404s forever and
    // Playwright's readiness poll never sees a 2xx. Point it at a page that actually exists.
    url: "http://localhost:5180/type.html",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
