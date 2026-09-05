import type { Express } from "express";
import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Container layout only (03-platform-deploy.md): the Dockerfile copies each
// SPA's build output to services/api/public/<app>. Workspace serves at "/",
// the customer portal at "/home", API stays under "/api/*" (registered
// before this in server.ts). Locally these directories don't exist — both
// apps run their own Vite dev servers instead — so this is a no-op then.
const __dirname = dirname(fileURLToPath(import.meta.url));

export function registerStaticRoutes(app: Express): void {
  const workspaceDist = join(__dirname, "..", "public", "workspace");
  const portalDist = join(__dirname, "..", "public", "portal");

  if (existsSync(portalDist)) {
    app.use("/home", express.static(portalDist));
    app.get("/home/*", (_req, res) => res.sendFile(join(portalDist, "index.html")));
  }
  if (existsSync(workspaceDist)) {
    app.use(express.static(workspaceDist));
    app.get("*", (_req, res) => res.sendFile(join(workspaceDist, "index.html")));
  }
}
