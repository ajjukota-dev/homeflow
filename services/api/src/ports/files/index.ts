import { createLocalFilesAdapter } from "./local-adapter";
import { createS3FilesAdapter } from "./s3-adapter";
import type { FilesPort } from "./types";

export type { FilesPort, PresignedUpload } from "./types";
export { ALLOWED_CONTENT_TYPES, MAX_FILE_BYTES, assertAllowedContentType, assertSafeKey } from "./types";
export { registerLocalFileRoutes } from "./local-routes";

// FILES_BUCKET set → s3 (prod); otherwise local-disk (dev/tests).
export function makeFilesPort(): FilesPort {
  const bucket = process.env.FILES_BUCKET;
  if (bucket) return createS3FilesAdapter(bucket, process.env.AWS_REGION ?? "ap-south-1");
  return createLocalFilesAdapter();
}

export const files: FilesPort = makeFilesPort();
