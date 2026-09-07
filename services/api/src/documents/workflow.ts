import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { computeReadiness } from "./readiness";
import { loadDocument, type DocumentRow } from "./store";

// 22 rule 6 (role-gated workflow transitions) + rule 7 (execution, final, archive). The
// canonical states this module walks: DRAFT -> INTERNAL_REVIEW -> AWAITING_APPROVAL (LEGAL, then
// COMMERCIAL only when a money-terms deviation exists) -> CUSTOMER_REVIEW -> APPROVED_FOR_EXECUTION
// -> EXECUTED -> FINAL (system, same call as execution) -> ARCHIVED. "Validation" (rule 6's system
// step) is folded into `submitForReview`: it re-runs the readiness check live rather than
// persisting a separate VALIDATING row, since nothing else can fail between generation and review.

export type ApprovalStage = "INTERNAL_REVIEW" | "LEGAL" | "COMMERCIAL";

async function assertStatus(doc: DocumentRow, expected: string): Promise<void> {
  if (doc.status !== expected) throw new AppError("conflict", `document is ${doc.status}, expected ${expected}`);
}

/** Rule 6: draft (Legal/CRM) -> validation (system, folded in here) -> internal review. */
export async function submitForReview(documentId: string, ctx: Ctx): Promise<DocumentRow> {
  await authorize(ctx, "documents", "WRITE");
  const doc = await loadDocument(documentId);
  await assertStatus(doc, "DRAFT");
  const readiness = await computeReadiness(doc.booking_id!, doc.family_code, db);
  if (readiness.result === "BLOCKED") throw new AppError("conflict", `readiness regressed since generation: ${readiness.facts.filter((f) => f.level === "BLOCKED").map((f) => f.message).join("; ")}`);
  await db.query(`UPDATE doc_factory_document SET status = 'INTERNAL_REVIEW', updated_at = now() WHERE id = $1`, [documentId]);
  return loadDocument(documentId);
}

async function approvedStages(documentId: string, tx: DbLike): Promise<Set<ApprovalStage>> {
  const r = await tx.query<{ stage: ApprovalStage }>(`SELECT DISTINCT stage FROM document_approval WHERE document_id = $1 AND decision = 'APPROVED'`, [documentId]);
  return new Set(r.rows.map((x) => x.stage));
}

export interface DocumentApprovalRow { document_id: string; stage: ApprovalStage; approver_user_id: string; decision: "APPROVED" | "REJECTED"; note: string | null; at: string }

/** GET /documents/:id/approvals — the Screens section's own "approvals stepper" needs this
 *  history; no route existed for it before this build (decideStage only returns the document). */
export async function listApprovals(documentId: string, ctx: Ctx): Promise<DocumentApprovalRow[]> {
  await authorize(ctx, "documents", "READ");
  return (await db.query<DocumentApprovalRow>(
    `SELECT document_id, stage, approver_user_id, decision, note, at::text AS at FROM document_approval WHERE document_id = $1 ORDER BY at`,
    [documentId]
  )).rows;
}

/** Rule 6: commercial approval only "when money terms deviate" — operationalised as at least one
 *  APPROVED deviation existing for this document (no monetary threshold is named in the spec, so
 *  no approval-matrix band is invented for it — UNCONFIRMED judgment call, flagged in the build note). */
async function commercialRequired(documentId: string, tx: DbLike): Promise<boolean> {
  const r = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM document_deviation WHERE document_id = $1 AND status = 'APPROVED'`, [documentId]);
  return (r.rows[0]?.n ?? 0) > 0;
}

/** Rule 6's role gates per stage: INTERNAL_REVIEW/LEGAL require the "documents" module WRITE
 *  (LEGAL per the seeded matrix); COMMERCIAL is Management explicitly — the matrix gives
 *  MANAGEMENT only READ on "documents", so this stage is a named exception, not matrix-driven. */
async function assertStageRole(stage: ApprovalStage, ctx: Ctx): Promise<void> {
  if (stage === "COMMERCIAL") requireRole(ctx, ["MANAGEMENT", "SUPER_ADMIN"]);
  else await authorize(ctx, "documents", "WRITE");
}

/** POST /documents/:id/approve|reject {stage}. */
export async function decideStage(documentId: string, stage: ApprovalStage, decision: "APPROVED" | "REJECTED", note: string | null, ctx: Ctx): Promise<DocumentRow> {
  await assertStageRole(stage, ctx);
  const doc = await loadDocument(documentId);
  if (stage === "INTERNAL_REVIEW") await assertStatus(doc, "INTERNAL_REVIEW");
  else await assertStatus(doc, "AWAITING_APPROVAL");
  if (stage === "COMMERCIAL" && !(await commercialRequired(documentId, db))) throw new AppError("conflict", "no money-terms deviation is APPROVED on this document — commercial approval is not required");

  return withTx(undefined, async (tx) => {
    await tx.query(`INSERT INTO document_approval (id, document_id, stage, approver_user_id, decision, note) VALUES ($1,$2,$3,$4,$5,$6)`, [
      "dap_" + randomUUID().slice(0, 8), documentId, stage, ctx.actor.user_id, decision, note ?? null,
    ]);
    if (decision === "REJECTED") {
      await tx.query(`UPDATE doc_factory_document SET status = 'REJECTED', updated_at = now() WHERE id = $1`, [documentId]);
      // "document.review_rejected", not the checklist family's "document.rejected" — the spec's
      // workflow event group names no rejection event of its own; this is a sanctioned extension
      // (02 Appendix B "Extend with X.*") kept distinct so the two meanings never collide on one type.
      await appendEvent(tx, { type: "document.review_rejected", entity_type: "doc_factory_document", entity_id: documentId, booking_id: doc.booking_id, payload: { stage }, ...actorFields(ctx) });
      return loadDocument(documentId, tx);
    }
    if (stage === "INTERNAL_REVIEW") {
      await tx.query(`UPDATE doc_factory_document SET status = 'AWAITING_APPROVAL', updated_at = now() WHERE id = $1`, [documentId]);
    }
    await appendEvent(tx, { type: "document.approved", entity_type: "doc_factory_document", entity_id: documentId, booking_id: doc.booking_id, payload: { stage }, ...actorFields(ctx) });
    return loadDocument(documentId, tx);
  });
}

/** POST /documents/:id/send-customer-review — requires LEGAL approved, and COMMERCIAL approved
 *  only if required (rule 6's approval-matrix note). */
export async function sendForCustomerReview(documentId: string, ctx: Ctx): Promise<DocumentRow> {
  await authorize(ctx, "documents", "WRITE");
  const doc = await loadDocument(documentId);
  await assertStatus(doc, "AWAITING_APPROVAL");
  const approved = await approvedStages(documentId, db);
  if (!approved.has("LEGAL")) throw new AppError("conflict", "legal approval is still outstanding");
  if ((await commercialRequired(documentId, db)) && !approved.has("COMMERCIAL")) throw new AppError("conflict", "commercial approval is still outstanding");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE doc_factory_document SET status = 'CUSTOMER_REVIEW', updated_at = now() WHERE id = $1`, [documentId]);
    await appendEvent(tx, { type: "document.customer_review_sent", entity_type: "doc_factory_document", entity_id: documentId, booking_id: doc.booking_id, ...actorFields(ctx) });
  });
  return loadDocument(documentId);
}

/** POST /documents/:id/approve-for-execution — Legal lead; rule 4: drops the draft watermark. */
export async function approveForExecution(documentId: string, ctx: Ctx): Promise<DocumentRow> {
  await authorize(ctx, "documents", "WRITE");
  const doc = await loadDocument(documentId);
  await assertStatus(doc, "CUSTOMER_REVIEW");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE doc_factory_document SET status = 'APPROVED_FOR_EXECUTION', is_draft_watermarked = false, updated_at = now() WHERE id = $1`, [documentId]);
    await appendEvent(tx, { type: "document.approved_for_execution", entity_type: "doc_factory_document", entity_id: documentId, booking_id: doc.booking_id, ...actorFields(ctx) });
  });
  return loadDocument(documentId);
}

export type ExecutionMode = "ESIGN" | "WET_SIGNATURE" | "REGISTRATION";
export interface ExecutionInput { mode: ExecutionMode; executed_on: string; signatories?: Record<string, unknown>[]; witnesses?: Record<string, unknown>[]; sro_reference?: string | null }

/** POST /documents/:id/record-execution — rule 7: REGISTRATION carries sro_reference (23's own
 *  case-linking isn't built — flagged, not faked). Rule 6's "final (system)" auto-follows in the
 *  same call: nothing else can act between EXECUTED and FINAL. AOS/customisation-agreement
 *  flipping 16/18's LEGAL gate input (rule 7) has no target yet (16/18 not built) — the
 *  `document.executed` event is real and is the hook a future subscriber would use. */
export async function recordExecution(documentId: string, input: ExecutionInput, ctx: Ctx): Promise<DocumentRow> {
  await authorize(ctx, "documents", "WRITE");
  const doc = await loadDocument(documentId);
  await assertStatus(doc, "APPROVED_FOR_EXECUTION");
  if (!input.executed_on) throw new AppError("validation", "executed_on is required", "executed_on");
  if (input.mode === "REGISTRATION" && !input.sro_reference?.trim()) throw new AppError("validation", "sro_reference is required for REGISTRATION mode", "sro_reference");

  return withTx(undefined, async (tx) => {
    await tx.query(
      `INSERT INTO execution_record (id, document_id, mode, executed_on, signatories, witnesses, sro_reference, recorded_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
      ["exr_" + randomUUID().slice(0, 8), documentId, input.mode, input.executed_on, JSON.stringify(input.signatories ?? []), JSON.stringify(input.witnesses ?? []), input.sro_reference ?? null, ctx.actor.user_id]
    );
    await tx.query(`UPDATE doc_factory_document SET status = 'FINAL', updated_at = now() WHERE id = $1`, [documentId]);
    await appendEvent(tx, { type: "document.executed", entity_type: "doc_factory_document", entity_id: documentId, booking_id: doc.booking_id, payload: { mode: input.mode, family_code: doc.family_code }, ...actorFields(ctx) });
    await appendEvent(tx, { type: "document.finalised", entity_type: "doc_factory_document", entity_id: documentId, booking_id: doc.booking_id, payload: { checksum: doc.checksum }, ...actorFields(ctx) });
    return loadDocument(documentId, tx);
  });
}

export async function archiveDocument(documentId: string, ctx: Ctx): Promise<DocumentRow> {
  await authorize(ctx, "documents", "WRITE");
  const doc = await loadDocument(documentId);
  await assertStatus(doc, "FINAL");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE doc_factory_document SET status = 'ARCHIVED', updated_at = now() WHERE id = $1`, [documentId]);
    await appendEvent(tx, { type: "document.archived", entity_type: "doc_factory_document", entity_id: documentId, booking_id: doc.booking_id, ...actorFields(ctx) });
  });
  return loadDocument(documentId);
}
