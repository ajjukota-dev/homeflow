import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FilesPort } from "./types";
import { assertSafeKey } from "./types";

// Dev/test adapter: bytes live on disk under ./.data/files, served by the
// API itself (see local-routes.ts) — there's no real "presigned URL"
// without S3, so putPresigned/getPresigned just point at that same-origin
// route (03-platform-deploy.md: "local-disk (./.data/files, served by API
// in dev)").
function dataDir(): string {
  return process.env.FILES_DIR ?? "./.data/files";
}

export function localFilePath(key: string): string {
  assertSafeKey(key);
  return join(dataDir(), key);
}

export function ensureLocalFilesDir(key: string): void {
  mkdirSync(dirname(localFilePath(key)), { recursive: true });
}

export function createLocalFilesAdapter(): FilesPort {
  return {
    async putPresigned(key, contentType) {
      assertSafeKey(key);
      return { url: `/api/files/${key}`, method: "PUT", headers: { "content-type": contentType } };
    },
    async getPresigned(key) {
      assertSafeKey(key);
      return `/api/files/${key}`;
    },
    async delete(key) {
      const p = localFilePath(key);
      if (existsSync(p)) unlinkSync(p);
    },
    async putBuffer(key, data) {
      ensureLocalFilesDir(key);
      writeFileSync(localFilePath(key), data);
    },
  };
}
