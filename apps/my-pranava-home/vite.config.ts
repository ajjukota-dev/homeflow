import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// My Pranava Home — customer portal. Runs on 5174, proxies /api to the local API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": "http://localhost:3001" },
  },
});
