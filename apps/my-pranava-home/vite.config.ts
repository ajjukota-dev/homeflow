import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// My Pranava Home — customer portal (technical/09 §7). Runs on 5174 and proxies
// /api and /auth to the API so the hf_session cookie stays same-origin in dev,
// exactly as it is when the container serves the built app by Host header.
const API = process.env.VITE_API_ORIGIN ?? "http://localhost:8001";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/auth": { target: API, changeOrigin: false },
      "/health": { target: API, changeOrigin: false },
    },
  },
});
