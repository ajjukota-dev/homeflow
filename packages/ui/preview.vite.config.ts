import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Builds packages/ui/preview/*.html into static, self-contained pages (docs/specs/32-design-system.md
// §3). Each page keeps its `<!-- @dsCard group="…" -->` first-line marker through the Vite build —
// verified by hand after `npm run preview:build` since Vite normally leaves leading HTML comments
// in place for a plain (non-templated) .html entry.
const PAGES = [
  "brand",
  "type",
  "colors",
  "spacing",
  "elevation",
  "motion",
  "forms",
  "buttons",
  "data-display",
  "navigation",
  "feedback",
  "overlays",
];

export default defineConfig({
  root: resolve(__dirname, "preview"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "preview/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((p) => [p, resolve(__dirname, `preview/${p}.html`)])),
    },
  },
  server: {
    port: 5180,
  },
});
