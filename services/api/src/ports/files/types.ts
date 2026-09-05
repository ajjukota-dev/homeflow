// files port (03-platform-deploy.md): object storage behind one contract,
// two adapters (local-disk for dev/tests, s3 for prod). Keys are always
// project/{project_id}/{entity}/{id}/{uuid}.{ext} — callers build the key,
// the port just stores/serves/deletes it.

export interface PresignedUpload {
  url: string;
  method: "PUT";
  headers?: Record<string, string>;
}

export interface FilesPort {
  putPresigned(key: string, contentType: string): Promise<PresignedUpload>;
  getPresigned(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  /** Server-generated content (rendered PDFs, not a user's presigned upload) — 22's Document Factory
   *  is the first caller (rule 9: PDF via the files port). */
  putBuffer(key: string, data: Buffer, contentType: string): Promise<void>;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB (03-platform-deploy.md)
export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export function assertAllowedContentType(contentType: string): void {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`content_type_not_allowed: ${contentType}`);
  }
}

// Keys become disk paths under the local adapter — reject anything that
// could escape the data directory (".." segments, absolute paths).
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.split("/").includes("..")) {
    throw new Error(`unsafe_key: ${key}`);
  }
}
