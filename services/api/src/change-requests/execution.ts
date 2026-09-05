import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { closeAction } from "../actions/core";
import { recordAsBuilt } from "../specification/revisions";
import type { SpecItems } from "../specification/baselines";
import { loadCr, assertCrActor, type CrRow } from "./store";
import { CUSTOMISATION_DESK_ROLES } from "./capture";

// 18 rule 8: execution -> ready for QA -> QA verified -> customer accepted -> as-built closed.
//
// The QA link is manual (staff picks an existing `qa_inspection` to associate), not
// auto-created: 08's four change_category codes (kitchen_layout/electrical/flooring_selection/
// structural) and 07's four component_definition codes (structure/mep_first_fix/flooring/
// finishing) don't correspond 1:1 (electrical has no component analogue; kitchen_layout has
// none either) — the same mismatched-vocabulary class of gap 15 already flagged for its own
// T11-component mapping. Forcing a guess would invent a correspondence the spec never states.

async function assertExecuting(crId: string): Promise<CrRow> {
  const cr = await loadCr(crId);
  if (cr.status !== "IN_PROGRESS") throw new AppError("conflict", `change request is ${cr.status}, not IN_PROGRESS`);
  return cr;
}

async function maybeAdvanceToReadyForQa(crId: string, ctx: Ctx, tx: DbLike): Promise<void> {
  const open = await tx.query(`SELECT 1 FROM cr_execution_action x JOIN action a ON a.id = x.action_id WHERE x.cr_id = $1 AND a.status NOT IN ('Closed','Cancelled')`, [crId]);
  if (open.rows.length > 0) return;
  const cr = await loadCr(crId, tx);
  await tx.query(`UPDATE change_request SET status = 'READY_FOR_QA', updated_at = now() WHERE id = $1`, [crId]);
  await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "IN_PROGRESS", to: "READY_FOR_QA" }, ...actorFields(ctx) });
}

/** Rule 8: close one execution action (site/procurement/vendor/drawing update); READY_FOR_QA
 *  once all of them are closed. */
export async function closeExecutionAction(actionId: string, note: string | undefined, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, STAFF_ROLES);
  const link = (await db.query<{ cr_id: string }>(`SELECT cr_id FROM cr_execution_action WHERE action_id = $1`, [actionId])).rows[0];
  if (!link) throw new AppError("not_found", "execution action not linked to a change request");
  await assertExecuting(link.cr_id);
  await closeAction(actionId, note, ctx); // own tx
  await withTx(undefined, (tx) => maybeAdvanceToReadyForQa(link.cr_id, ctx, tx));
  return loadCr(link.cr_id);
}

/** Manual QA link — see file header for why this isn't auto-selected. */
export async function linkQaInspection(crId: string, qaInspectionId: string, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, [...CUSTOMISATION_DESK_ROLES, "QA"]);
  const cr = await loadCr(crId);
  if (cr.status !== "READY_FOR_QA") throw new AppError("conflict", `change request is ${cr.status}, not READY_FOR_QA`);
  const insp = (await db.query<{ unit_id: string }>(`SELECT unit_id FROM qa_inspection WHERE id = $1`, [qaInspectionId])).rows[0];
  if (!insp) throw new AppError("not_found", "inspection not found");
  if (insp.unit_id !== cr.unit_id) throw new AppError("validation", "that inspection is for a different unit", "qa_inspection_id");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_request SET qa_inspection_id = $2, updated_at = now() WHERE id = $1`, [crId, qaInspectionId]);
  });
  return loadCr(crId);
}

/** Rule 8: QA inspection (15) with evidence -> QA_VERIFIED. Requires the linked inspection to
 *  have PASSED (15's own evidence/verification workflow already enforces the "with evidence"
 *  part before it can reach that status). */
export async function markQaVerified(crId: string, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, ["QA", "MANAGEMENT", "SUPER_ADMIN"]);
  const cr = await loadCr(crId);
  if (cr.status !== "READY_FOR_QA") throw new AppError("conflict", `change request is ${cr.status}, not READY_FOR_QA`);
  if (!cr.qa_inspection_id) throw new AppError("validation", "link a QA inspection (15) before marking verified", "qa_inspection_id");
  const insp = (await db.query<{ status: string }>(`SELECT status FROM qa_inspection WHERE id = $1`, [cr.qa_inspection_id])).rows[0];
  if (insp?.status !== "PASSED") throw new AppError("conflict", `linked inspection is ${insp?.status ?? "unknown"}, not PASSED`);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_request SET status = 'QA_VERIFIED', updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.qa_verified", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { qa_inspection_id: cr.qa_inspection_id }, ...actorFields(ctx) });
  });
  return loadCr(crId);
}

/** Rule 8: customer acceptance (portal, or CRM recording it on the customer's behalf). */
export async function customerAcceptCr(crId: string, ctx: Ctx): Promise<CrRow> {
  const cr = await loadCr(crId);
  await assertCrActor(cr, ctx, ["CRM", "MANAGEMENT", "SUPER_ADMIN"]);
  if (cr.status !== "QA_VERIFIED") throw new AppError("conflict", `change request is ${cr.status}, not QA_VERIFIED`);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_request SET status = 'CUSTOMER_ACCEPTED', customer_accepted_at = now(), updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.customer_accepted", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: {}, ...actorFields(ctx) });
  });
  return loadCr(crId);
}

/** Rule 8: as-built record (09) closes the loop — updates the permanent Unit Digital Twin. */
export async function asBuiltClose(crId: string, input: { as_built_items: SpecItems; drawing_file_keys?: string[]; note?: string | null }, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await loadCr(crId);
  if (cr.status !== "CUSTOMER_ACCEPTED") throw new AppError("conflict", `change request is ${cr.status}, not CUSTOMER_ACCEPTED`);
  await withTx(undefined, async (tx) => {
    await recordAsBuilt(cr.unit_id, { change_request_id: crId, as_built_items: input.as_built_items, drawing_file_keys: input.drawing_file_keys, note: input.note }, tx, actorFields(ctx));
    await tx.query(`UPDATE change_request SET status = 'AS_BUILT_CLOSED', as_built_closed_at = now(), updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.as_built_closed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: {}, ...actorFields(ctx) });
  });
  return loadCr(crId);
}
