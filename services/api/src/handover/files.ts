import { randomUUID } from "node:crypto";
import { AppError, type Ctx } from "../authz/types";
import { requireRole } from "../authz/requireRole";
import { assertEntityScope } from "../authz/entity-scope";
import { files, assertAllowedContentType } from "../ports/files";
import { loadOrCreateCase } from "./store";

// 16-handover-gates.md: signatures/photos are files-port keys (project/...), never data-URLs.

export function assertStoredFileKey(value: string | null | undefined, field: string): void {
  if (value == null || value === "") return;
  if (value.startsWith("data:")) {
    throw new AppError("validation", `${field} must be a files-port key, not a data URL`, field);
  }
  if (!value.startsWith("project/")) {
    throw new AppError("validation", `${field} must be a storage key under project/`, field);
  }
}

export async function presignHandoverSignature(
  bookingId: string,
  input: { kind: "customer" | "company" | "photo"; content_type: string },
  ctx: Ctx
): Promise<{ key: string; upload: Awaited<ReturnType<typeof files.putPresigned>> }> {
  requireRole(ctx, ["QA", "FM", "MANAGEMENT", "SUPER_ADMIN"]);
  await assertEntityScope(ctx, "booking", bookingId, "write");
  if (!input.content_type) throw new AppError("validation", "content_type is required", "content_type");
  assertAllowedContentType(input.content_type);
  const hoCase = await loadOrCreateCase(bookingId);
  const ext = input.content_type.split("/")[1] ?? "bin";
  const key = `project/${hoCase.project_id}/handover/${hoCase.id}/${input.kind}-${randomUUID()}.${ext}`;
  const upload = await files.putPresigned(key, input.content_type);
  return { key, upload };
}
