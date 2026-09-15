import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/db/vitest-rls-setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
