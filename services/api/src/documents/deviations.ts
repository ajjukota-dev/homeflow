import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { loadDocument } from "./store";

// 22 rule 5: NEGOTIABLE_WITH_APPROVAL clause edits go through a deviation, approved by Legal but
// never by the raiser (t7 "no self-approval") — an approved deviation is applied on the document's
// NEXT regeneration (generate.ts::applyApprovedDeviations), since data_snapshot/selected_clauses
// are frozen at generation (rule 3) and never mutated in place.

export interface DeviationRow {
  id: string; document_id: string; clause_code: string; original: string | null; proposed: string; reason: string;
  raised_by: string; status: "RAISED" | "APPROVED" | "REJECTED"; approved_by: string | null; created_at: string;
}
const SELECT = `SELECT id, document_id, clause_code, original, proposed, reason, raised_by, status, approved_by, created_at::text AS created_at FROM document_deviation`;

async function loadDeviation(id: string, tx: DbLike = db): Promise<DeviationRow> {
  const r = await tx.query<DeviationRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "deviation not found");
  return r.rows[0];
}

export async function listDeviations(documentId: string, ctx: Ctx): Promise<DeviationRow[]> {
  await authorize(ctx, "documents", "READ");
  return (await db.query<DeviationRow>(`${SELECT} WHERE document_id = $1 ORDER BY created_at`, [documentId])).rows;
}

/** Approved deviations for a document — generate.ts applies these to the clause body on the next
 *  regeneration AND carries a fresh row forward onto the new document (rule 6's "commercial
 *  approval when money terms deviate" reads `document_deviation` by the CURRENT document's own
 *  id, so an approval attached only to a superseded version would never be seen again). */
export async function approvedDeviations(documentId: string, tx: DbLike = db): Promise<DeviationRow[]> {
  return (await tx.query<DeviationRow>(`${SELECT} WHERE document_id = $1 AND status = 'APPROVED'`, [documentId])).rows;
}

/** Carries an already-approved deviation forward onto a newly generated document — no new
 *  raise/approve event, since nothing was decided again; it's bookkeeping so the new version's
 *  own deviation list (and rule 6's commercial-approval check) sees it. */
export async function carryForwardDeviation(newDocumentId: string, dev: DeviationRow, tx: DbLike): Promise<void> {
  await tx.query(
    `INSERT INTO document_deviation (id, document_id, clause_code, original, proposed, reason, raised_by, status, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED',$8)`,
    ["dev_" + randomUUID().slice(0, 8), newDocumentId, dev.clause_code, dev.original, dev.proposed, dev.reason, dev.raised_by, dev.approved_by]
  );
}

export async function raiseDeviation(documentId: string, input: { clause_code: string; proposed: string; reason: string }, ctx: Ctx): Promise<DeviationRow> {
  await authorize(ctx, "documents", "WRITE");
  const doc = await loadDocument(documentId);
  const clause = doc.selected_clauses.find((c) => c.code === input.clause_code);
  if (!clause) throw new AppError("validation", `clause ${input.clause_code} is not on this document`, "clause_code");
  if (clause.type !== "NEGOTIABLE_WITH_APPROVAL") throw new AppError("validation", `clause ${input.clause_code} is ${clause.type} and cannot take a deviation`, "clause_code");
  if (!input.proposed?.trim() || !input.reason?.trim()) throw new AppError("validation", "proposed and reason are required");
  const id = "dev_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    await tx.query(
      `INSERT INTO document_deviation (id, document_id, clause_code, original, proposed, reason, raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, documentId, input.clause_code, clause.body_html, input.proposed.trim(), input.reason.trim(), ctx.actor.user_id]
    );
    await appendEvent(tx, { type: "document.deviation_raised", entity_type: "document_deviation", entity_id: id, booking_id: doc.booking_id, payload: { document_id: documentId, clause_code: input.clause_code }, ...actorFields(ctx) });
  });
  return loadDeviation(id);
}

/** Segregation of duties (t7): approver must be Legal and cannot be the raiser. */
async function assertCanDecide(dev: DeviationRow, ctx: Ctx): Promise<void> {
  await authorize(ctx, "documents", "WRITE");
  if (ctx.actor.user_id === dev.raised_by) throw new AppError("forbidden", "the raiser cannot approve or reject their own deviation");
  if (dev.status !== "RAISED") throw new AppError("conflict", `deviation is ${dev.status}`);
}

export async function approveDeviation(id: string, ctx: Ctx): Promise<DeviationRow> {
  const dev = await loadDeviation(id);
  await assertCanDecide(dev, ctx);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE document_deviation SET status = 'APPROVED', approved_by = $2 WHERE id = $1`, [id, ctx.actor.user_id]);
    await appendEvent(tx, { type: "document.deviation_approved", entity_type: "document_deviation", entity_id: id, payload: { clause_code: dev.clause_code }, ...actorFields(ctx) });
  });
  return loadDeviation(id);
}

export async function rejectDeviation(id: string, ctx: Ctx): Promise<DeviationRow> {
  const dev = await loadDeviation(id);
  await assertCanDecide(dev, ctx);
  await db.query(`UPDATE document_deviation SET status = 'REJECTED', approved_by = $2 WHERE id = $1`, [id, ctx.actor.user_id]);
  return loadDeviation(id);
}
