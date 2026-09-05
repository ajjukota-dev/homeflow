import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// My Pranava Home — customer portal. Runs on 5174, proxies /api to the local API.
// In the container the API serves this build's assets under /home
// (03-platform-deploy.md) — the Docker build sets BASE_PATH=/home/;
// local dev keeps the default "/" so localhost:5174 still works.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": "http://localhost:3001" },
  },
});
