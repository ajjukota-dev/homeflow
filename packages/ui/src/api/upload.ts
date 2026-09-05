/**
 * presign → PUT → confirm (technical/08 §1, 09 §6). The bytes go straight to
 * S3/MinIO; the API only ever sees metadata. Images are downscaled in the
 * browser first so a 12 MP phone photo does not become a 6 MB evidence file.
 */
import { api, ApiError } from "./client";

export const MAX_IMAGE_EDGE_PX = 2000;

export interface PresignResponse {
  file_id: string;
  upload_url: string;
  /** Headers the presigned PUT was signed with; send them back verbatim. */
  headers?: Record<string, string>;
}

export interface UploadRequest {
  file: File;
  entity_type: string;
  entity_id: string;
  kind?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface UploadedFile {
  file_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}

/** Downscale so the longest edge is at most `maxEdge`. Non-images pass through. */
export async function downscaleImage(file: File, maxEdge = MAX_IMAGE_EDGE_PX): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= maxEdge) {
    bitmap.close();
    return file;
  }
  const scale = maxEdge / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

function put(url: string, body: Blob, headers: Record<string, string>, onProgress?: (f: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError({ code: "UPLOAD_FAILED", message: `Storage rejected the file (${xhr.status}).`, status: xhr.status }));
    xhr.onerror = () => reject(new ApiError({ code: "NETWORK", message: "The upload could not reach storage.", status: 0 }));
    xhr.onabort = () => reject(new ApiError({ code: "CANCELLED", message: "Upload cancelled.", status: 0 }));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

export async function uploadFile(req: UploadRequest): Promise<UploadedFile> {
  const file = await downscaleImage(req.file);
  const presign = (await api.post("/files/presign", {
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    entity_type: req.entity_type,
    entity_id: req.entity_id,
    kind: req.kind,
  })) as unknown as PresignResponse;

  await put(
    presign.upload_url,
    file,
    presign.headers ?? { "Content-Type": file.type || "application/octet-stream" },
    req.onProgress,
    req.signal,
  );

  return (await api.post(`/files/${presign.file_id}/confirm`, {})) as unknown as UploadedFile;
}
