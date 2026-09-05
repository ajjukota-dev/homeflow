import { api, apiErrorToast } from "@/lib/api";

/**
 * Parse a filename out of a Content-Disposition header.
 * Handles both the plain `filename="foo.pdf"` form and the RFC 5987
 * `filename*=UTF-8''foo%20bar.pdf` form. Returns null if the header
 * doesn't carry a usable filename.
 */
function filenameFromDisposition(disposition) {
  if (!disposition) return null;
  const starMatch = /filename\*\s*=\s*(?:[^']*'[^']*')?([^;]+)/i.exec(disposition);
  if (starMatch && starMatch[1]) {
    try {
      return decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  if (plainMatch && plainMatch[1]) return plainMatch[1].trim();
  return null;
}

/**
 * When the backend cannot find the underlying blob it returns
 *   404 { detail: { detail: "file_missing", filename: "<name>" } }
 * or  404 { detail: { detail: "attachment_deleted", filename: "<name>" } }
 *
 * axios delivers the error body inside an axios Blob when
 * `responseType: 'blob'` — we need to parse it back to JSON.
 */
async function parseErrorBlob(err) {
  const data = err?.response?.data;
  if (!data) return null;
  if (typeof data === "object" && !(data instanceof Blob)) return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    try {
      const text = await data.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

async function showMissingToast(filename) {
  const label = filename ? `“${filename}”` : "This file";
  const msg = `${label} is no longer available. Please re-upload.`;
  try {
    const { toast } = await import("sonner");
    toast.error(msg);
  } catch {
    /* toast lib unavailable — silent */
  }
}

/**
 * Download an attachment via the authenticated axios instance and
 * trigger a browser save dialog. This is the ONLY sanctioned way to
 * fetch `/api/attachments/{id}/download` from the frontend.
 *
 * On the server-known "file_missing" 404 we show a friendly toast
 * instead of the raw error text. Other errors fall through to
 * `apiErrorToast()` which respects our RBAC-403 silencing rules.
 *
 * @param {{id: string, filename?: string, file_missing?: boolean}} att
 * @returns {Promise<boolean>} true on success, false on failure
 */
export async function downloadAttachment(att) {
  if (!att?.id) return false;
  // Short-circuit: the caller may already know the file is missing
  // (e.g. from a list payload). Skip the network round-trip.
  if (att.file_missing) {
    await showMissingToast(att.filename);
    return false;
  }
  try {
    const res = await api.get(`/attachments/${att.id}/download`, {
      responseType: "blob",
    });
    const disposition =
      res.headers?.["content-disposition"] || res.headers?.["Content-Disposition"];
    const filename = filenameFromDisposition(disposition) || att.filename || "download";
    const blobUrl = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
    return true;
  } catch (err) {
    if (err?.response?.status === 404) {
      const body = await parseErrorBlob(err);
      const inner = body?.detail;
      const code = typeof inner === "object" ? inner?.detail : inner;
      const fname = (typeof inner === "object" && inner?.filename) || att.filename;
      if (code === "file_missing" || code === "attachment_deleted") {
        await showMissingToast(fname);
        return false;
      }
    }
    apiErrorToast(err);
    return false;
  }
}
