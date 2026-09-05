import { defineConfig } from "vitest/config";
import { transformWithEsbuild, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Workspace — v1's frontend on Vite (technical/09 §1, §7; TASKS Vivek 8).
 *
 * v1 was CRA + craco. Two things carry across unchanged so 146 files did not
 * have to be touched: the `@` alias, and JSX inside `.js` files. Vite's esbuild
 * step gives `.js` the plain JS loader, and in a production build
 * @vitejs/plugin-react skips Babel entirely, so three of v1's files (`App.js`,
 * `index.js`, `lib/stageHelp.js`) would fail to parse. The plugin below hands
 * those to esbuild with the JSX loader first. Renaming happens file by file as
 * each page is ported to TypeScript, and this plugin is deleted with the last one.
 *
 * `/api` and `/auth` proxy to the API so the `hf_session` cookie stays
 * same-origin in dev exactly as it is in the container (technical/03 §3).
 */
const API = process.env.VITE_API_ORIGIN ?? "http://localhost:8001";

function jsxInJsFiles(): Plugin {
  return {
    name: "homeflow:jsx-in-js",
    enforce: "pre",
    async transform(code, id) {
      if (!id.endsWith(".js") || id.includes("node_modules")) return null;
      if (!/<[A-Za-z/]/.test(code)) return null;
      const out = await transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
      // esbuild types `sourcesContent` as (string | null)[]; rollup wants string[].
      return { code: out.code, map: out.map as unknown as null };
    },
  };
}

export default defineConfig({
  plugins: [jsxInJsFiles(), react({ include: /\.(js|jsx|ts|tsx)$/ })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  optimizeDeps: {
    esbuildOptions: { loader: { ".js": "jsx" } },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/auth": { target: API, changeOrigin: false },
      "/health": { target: API, changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: false },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    css: false,
  },
});
