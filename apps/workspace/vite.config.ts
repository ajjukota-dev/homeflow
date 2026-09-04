import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// HomeFlow workspace app — dev server + build + test config.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    watch: false,
    // Playwright specs live in e2e/ and have their own runner (`npm run e2e`).
    exclude: ["e2e/**", "node_modules/**"],
  },
});
