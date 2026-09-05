import type { Express } from "express";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { ensureLocalFilesDir, localFilePath } from "./local-adapter";

// Backs the local-disk adapter's putPresigned/getPresigned URLs
// (/api/files/<key>) — dev/test only; the s3 adapter needs no server route.
export function registerLocalFileRoutes(app: Express): void {
  app.put("/api/files/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    ensureLocalFilesDir(key);
    await pipeline(req, createWriteStream(localFilePath(key)));
    res.status(204).end();
  });

  app.get("/api/files/*", (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    const path = localFilePath(key);
    if (!existsSync(path)) {
      res.status(404).json({ errors: [{ code: "not_found" }] });
      return;
    }
    createReadStream(path).pipe(res);
  });
}
