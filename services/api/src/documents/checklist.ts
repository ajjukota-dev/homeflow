import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { todayIst } from "../authz/clock";
import { files, assertAllowedContentType } from "../ports/files";
import { createAction } from "../actions/core";

// 22 rule 8: customer document checklist. Gated on "customer_documents" (LEGAL WRITE per the
// seeded matrix — trusted over the spec's "CRM" screen attribution, same discipline as 08/15/24's
// role findings); a category's `verifier_role` column is informational/routing metadata only.

export type DocCategory =
  | "PAN" | "IDENTITY_PROOF" | "ADDRESS_PROOF" | "PHOTOGRAPH" | "PASSPORT" | "OCI" | "BOOKING_FORM"
  | "COST_SHEET" | "AGREEMENT" | "TDS_CHALLAN" | "LOAN_DOCUMENTS" | "REGISTRATION_DOCUMENTS" | "POA" | "HANDOVER_DOCUMENTS" | "OTHER";
export type DocStatus = "REQUIRED" | "REQUESTED" | "RECEIVED" | "VALIDATING" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "EXPIRED";

export interface CustomerDocumentRow {
  id: string; booking_id: string; customer_id: string; category: DocCategory; required: boolean; applicable: boolean; na_reason: string | null;
  status: DocStatus; verifier_role: string; file_keys: string[]; expires_on: string | null; rejected_reason: string | null; verified_by: string | null; verified_at: string | null;
}
const SELECT = `SELECT id, booking_id, customer_id, category, required, applicable, na_reason,
  CASE WHEN status = 'ACCEPTED' AND expires_on IS NOT NULL AND expires_on < $2 THEN 'EXPIRED' ELSE status END AS status,
  verifier_role, file_keys, expires_on::text AS expires_on, rejected_reason, verified_by, verified_at::text AS verified_at
  FROM customer_document`;

async function loadDoc(id: string, tx: DbLike = db): Promise<CustomerDocumentRow> {
  const r = await tx.query<CustomerDocumentRow>(`${SELECT} WHERE id = $1`, [id, todayIst()]);
  if (!r.rows[0]) throw new AppError("not_found", "customer document not found");
  return r.rows[0];
}

export async function listChecklist(bookingId: string, ctx: Ctx): Promise<CustomerDocumentRow[]> {
  await authorize(ctx, "customer_documents", "READ");
  return (await db.query<CustomerDocumentRow>(`${SELECT} WHERE booking_id = $1 ORDER BY category`, [bookingId, todayIst()])).rows;
}

/** Rule 8 default verifier by category — UNCONFIRMED (spec cites [E §8.2] table, not available here);
 *  LOAN_DOCUMENTS -> ACCOUNTS is the one value the spec text states explicitly. */
function defaultVerifierRole(category: DocCategory): string {
  if (category === "LOAN_DOCUMENTS") return "ACCOUNTS";
  if (category === "AGREEMENT" || category === "TDS_CHALLAN" || category === "REGISTRATION_DOCUMENTS") return "LEGAL";
  return "CRM";
}

/** Rule 8: seeds the checklist per booking from `document_checklist_rule` (residency x product_type
 *  x project scope) — real trigger is CRM acceptance (17's `sales_handover.accepted`, via
 *  `subscribers.ts`); a residency-change re-trigger has no event to hook (flagged, not built).
 *  Idempotent (ON CONFLICT DO NOTHING per category) so a re-run never overwrites progress. */
export async function seedChecklistForBooking(bookingId: string, tx: DbLike): Promise<void> {
  const b = await tx.query<{ project_id: string; product_type: string; customer_id: string | null; residency: string | null }>(
    `SELECT b.project_id, u.product_type, ba.customer_id, c.residency
       FROM booking b JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant ba ON ba.booking_id = b.id AND ba.role = 'primary'
       LEFT JOIN customer c ON c.id = ba.customer_id
      WHERE b.id = $1`,
    [bookingId]
  );
  const row = b.rows[0];
  if (!row?.customer_id) return; // no primary applicant yet — nothing to seed against
  const residency = row.residency ?? "RESIDENT";
  const rules = await tx.query<{ category: DocCategory; required: boolean }>(
    `SELECT category, required FROM document_checklist_rule
      WHERE (project_id = $1 OR project_id IS NULL) AND residency IN ($2, 'ANY') AND (product_type = $3 OR product_type IS NULL)
      ORDER BY (project_id IS NULL) ASC`,
    [row.project_id, residency, row.product_type]
  );
  const seen = new Set<string>();
  for (const r of rules.rows) {
    if (seen.has(r.category)) continue; // project-scoped row (returned first) wins over the standard one
    seen.add(r.category);
    await tx.query(
      `INSERT INTO customer_document (id, booking_id, customer_id, category, required, verifier_role)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (booking_id, category) DO NOTHING`,
      ["cdoc_" + randomUUID().slice(0, 8), bookingId, row.customer_id, r.category, r.required, defaultVerifierRole(r.category)]
    );
  }
}

/** POST /customer-documents/:id/request — REQUIRED -> REQUESTED, plus a customer-visible action (10). */
export async function requestDocument(id: string, ctx: Ctx): Promise<CustomerDocumentRow> {
  await authorize(ctx, "customer_documents", "WRITE");
  const doc = await loadDoc(id);
  if (doc.status !== "REQUIRED") throw new AppError("conflict", `document is ${doc.status}`);
  await withTx(undefined, async (tx) => {
    const b = await tx.query<{ project_id: string; unit_id: string }>(`SELECT project_id, unit_id FROM booking WHERE id = $1`, [doc.booking_id]);
    await tx.query(`UPDATE customer_document SET status = 'REQUESTED', updated_at = now() WHERE id = $1`, [id]);
    await createAction(
      {
        type: "exec_evidence", title: `Upload ${doc.category.replace(/_/g, " ").toLowerCase()}`, project_id: b.rows[0]!.project_id,
        source_module: "documents", source_entity_type: "customer_document", source_entity_id: id, booking_id: doc.booking_id,
        unit_id: b.rows[0]!.unit_id, customer_id: doc.customer_id, owner_role: "CUSTOMER", customer_visible: true,
        customer_title: `Please upload your ${doc.category.replace(/_/g, " ").toLowerCase()}`, origin: "MANUAL", created_by: ctx.actor.user_id,
      },
      tx
    );
    await appendEvent(tx, { type: "document.requested", entity_type: "customer_document", entity_id: id, project_id: b.rows[0]!.project_id, booking_id: doc.booking_id, customer_id: doc.customer_id, payload: { category: doc.category }, ...actorFields(ctx) });
  });
  return loadDoc(id);
}

/** POST /customer-documents/:id/upload — customer or staff-on-behalf; re-upload after ACCEPTED
 *  creates a new file version and re-enters VALIDATING (never silently reverts — event fired). */
export async function uploadDocument(id: string, input: { content_type: string }, ctx: Ctx): Promise<{ document: CustomerDocumentRow; key: string; upload: Awaited<ReturnType<typeof files.putPresigned>> }> {
  const doc = await loadDoc(id);
  if (doc.status === "SUPERSEDED") throw new AppError("conflict", "document is superseded");
  if (!input.content_type) throw new AppError("validation", "content_type is required", "content_type");
  assertAllowedContentType(input.content_type);
  const b = await db.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [doc.booking_id]);
  const ext = input.content_type === "application/pdf" ? "pdf" : input.content_type.split("/")[1]!;
  const key = `project/${b.rows[0]!.project_id}/customer_document/${id}/${randomUUID()}.${ext}`;
  const upload = await files.putPresigned(key, input.content_type);
  const wasAccepted = doc.status === "ACCEPTED";
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE customer_document SET status = 'VALIDATING', file_keys = array_append(file_keys, $2), rejected_reason = NULL, updated_at = now() WHERE id = $1`, [id, key]);
    await appendEvent(tx, {
      type: "document.received", entity_type: "customer_document", entity_id: id, project_id: b.rows[0]!.project_id, booking_id: doc.booking_id, customer_id: doc.customer_id,
      payload: { category: doc.category, re_upload: wasAccepted }, ...actorFields(ctx),
    });
  });
  return { document: await loadDoc(id), key, upload };
}

/** POST /customer-documents/:id/validate — a real (if minimal) check: at least one file uploaded.
 *  No content-level validation exists (format/virus-scan) — flagged, not faked. */
export async function validateDocument(id: string, ctx: Ctx): Promise<CustomerDocumentRow> {
  await authorize(ctx, "customer_documents", "READ");
  const doc = await loadDoc(id);
  if (doc.status !== "VALIDATING") throw new AppError("conflict", `document is ${doc.status}`);
  if (doc.file_keys.length === 0) throw new AppError("conflict", "no file uploaded yet");
  return doc;
}

export async function acceptDocument(id: string, ctx: Ctx): Promise<CustomerDocumentRow> {
  await authorize(ctx, "customer_documents", "WRITE");
  const doc = await loadDoc(id);
  if (doc.status !== "VALIDATING") throw new AppError("conflict", `document is ${doc.status}`);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE customer_document SET status = 'ACCEPTED', verified_by = $2, verified_at = now(), updated_at = now() WHERE id = $1`, [id, ctx.actor.user_id]);
    await appendEvent(tx, { type: "document.validated", entity_type: "customer_document", entity_id: id, booking_id: doc.booking_id, customer_id: doc.customer_id, payload: { category: doc.category }, ...actorFields(ctx) });
  });
  return loadDoc(id);
}

export async function rejectDocument(id: string, reason: string, ctx: Ctx): Promise<CustomerDocumentRow> {
  await authorize(ctx, "customer_documents", "WRITE");
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  const doc = await loadDoc(id);
  if (doc.status !== "VALIDATING") throw new AppError("conflict", `document is ${doc.status}`);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE customer_document SET status = 'REJECTED', rejected_reason = $2, verified_by = $3, verified_at = now(), updated_at = now() WHERE id = $1`, [id, reason.trim(), ctx.actor.user_id]);
    await appendEvent(tx, { type: "document.rejected", entity_type: "customer_document", entity_id: id, booking_id: doc.booking_id, customer_id: doc.customer_id, payload: { category: doc.category, reason: reason.trim() }, ...actorFields(ctx) });
  });
  return loadDoc(id);
}

export async function markNotApplicable(id: string, reason: string, ctx: Ctx): Promise<CustomerDocumentRow> {
  await authorize(ctx, "customer_documents", "WRITE");
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await db.query(`UPDATE customer_document SET applicable = false, na_reason = $2, updated_at = now() WHERE id = $1`, [id, reason.trim()]);
  return loadDoc(id);
}

// --- Studio config: document_checklist_rule (residency x product_type x project scope) ---
export interface ChecklistRuleRow { id: string; residency: string; product_type: string | null; project_id: string | null; category: DocCategory; required: boolean; stage_code: string | null }

export async function listChecklistRules(ctx: Ctx): Promise<ChecklistRuleRow[]> {
  await authorize(ctx, "customer_documents", "READ");
  return (await db.query<ChecklistRuleRow>(`SELECT id, residency, product_type, project_id, category, required, stage_code FROM document_checklist_rule ORDER BY residency, category`)).rows;
}

export async function putChecklistRules(rules: Omit<ChecklistRuleRow, "id">[], ctx: Ctx): Promise<ChecklistRuleRow[]> {
  await authorize(ctx, "customer_documents", "WRITE");
  if (!Array.isArray(rules) || rules.length === 0) throw new AppError("validation", "rules must be a non-empty list", "rules");
  const ids: string[] = [];
  for (const r of rules) {
    if (!r.residency || !r.category) throw new AppError("validation", "residency and category are required", "rules");
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM document_checklist_rule WHERE COALESCE(project_id,'') = COALESCE($1,'') AND residency = $2 AND COALESCE(product_type,'') = COALESCE($3,'') AND category = $4`,
      [r.project_id ?? null, r.residency, r.product_type ?? null, r.category]
    );
    const id = existing.rows[0]?.id ?? "dcr_" + randomUUID().slice(0, 8);
    await db.query(
      `INSERT INTO document_checklist_rule (id, residency, product_type, project_id, category, required, stage_code) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET required = $6, stage_code = $7`,
      [id, r.residency, r.product_type ?? null, r.project_id ?? null, r.category, r.required ?? true, r.stage_code ?? null]
    );
    ids.push(id);
  }
  return (await db.query<ChecklistRuleRow>(`SELECT id, residency, product_type, project_id, category, required, stage_code FROM document_checklist_rule WHERE id = ANY($1::text[])`, [ids])).rows;
}

/** Readiness's KYC check (rule 2's Sale Deed example) — every REQUIRED+applicable category ACCEPTED. */
export async function allRequiredAccepted(bookingId: string, tx: DbLike = db): Promise<boolean> {
  const r = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM customer_document WHERE booking_id = $1 AND required AND applicable AND status <> 'ACCEPTED'`,
    [bookingId]
  );
  return (r.rows[0]?.n ?? 0) === 0;
}
