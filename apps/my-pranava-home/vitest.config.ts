import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Playwright specs live in e2e/ and are run by `npm run e2e`, not Vitest.
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
