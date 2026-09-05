import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { createAction } from "../actions/core";
import { createDraftRevision, releaseRevision } from "../specification/revisions";
import { useException } from "../changeability/core";
import { DEMAND_SELECT, mapDemands } from "../demands";
import { loadCr, listCrItems, type CrRow } from "./store";
import { CUSTOMISATION_DESK_ROLES } from "./capture";

// 18 rules 6, 7, 11, 12: payment gate, release (spec revision + execution actions), exception
// consumption, journey activation.
//
// Rule 12 ("first CR on a booking activates the conditional Customisation stage") is 06's own
// already-documented gap (journey/instances.ts's header names `change_request.created` by name
// as an event conditional-stage re-evaluation would need to consume, and confirms it isn't
// wired — 06 only evaluates conditional stages at journey creation, never re-evaluates later).
// This fires the event; wiring 06's consumer is real, separate work, not invented here.

const WAIVER_AUTHORITY_ROLES = ["MANAGEMENT", "SUPER_ADMIN"]; // UNCONFIRMED — customisation_policy has no configured waiver-authority field (p12 names one, the Data table doesn't)

async function assertPaymentCleared(cr: CrRow): Promise<void> {
  if (cr.payment_gate === "WAIVED") return;
  if (!cr.payment_demand_id) return; // gate configured at 0% — nothing was ever raised
  const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [cr.payment_demand_id]))[0];
  if (!d || d.remaining > 0) throw new AppError("conflict", "payment gate not satisfied — post the receipt (19) or record a waiver first");
}

/** Rule 6: AWAITING_PAYMENT -> APPROVED once receipts (19) cover the gate, checked at this
 *  explicit transition (no scheduler exists — same gap already documented for 06/12/19/21). */
export async function confirmPaymentGate(crId: string, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await loadCr(crId);
  if (cr.status !== "AWAITING_PAYMENT") throw new AppError("conflict", `change request is ${cr.status}, not AWAITING_PAYMENT`);
  await assertPaymentCleared(cr);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_request SET status = 'APPROVED', updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "AWAITING_PAYMENT", to: "APPROVED" }, ...actorFields(ctx) });
  });
  return loadCr(crId);
}

/** Rule 6's "authorised exception" — an explicit waiver instead of a payment. */
export async function waivePayment(crId: string, reason: string, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, WAIVER_AUTHORITY_ROLES);
  const cr = await loadCr(crId);
  if (cr.status !== "AWAITING_PAYMENT") throw new AppError("conflict", `change request is ${cr.status}, not AWAITING_PAYMENT`);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_request SET status = 'APPROVED', payment_gate = 'WAIVED', payment_waiver_authority = $2, updated_at = now() WHERE id = $1`, [crId, ctx.actor.user_id]);
    await appendEvent(tx, { type: "change_request.payment_waived", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { reason: reason.trim() }, ...actorFields(ctx) });
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "AWAITING_PAYMENT", to: "APPROVED" } });
  });
  return loadCr(crId);
}

/** Rule 7: release — creates the spec revision, generates execution actions, consumes the gate
 *  exception (rule 11), emits `drawing.released` (via 09's own releaseRevision). */
export async function releaseChangeRequest(crId: string, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await loadCr(crId);
  if (cr.status !== "APPROVED") throw new AppError("conflict", `change request is ${cr.status}, not APPROVED`);
  const items = await listCrItems(crId);

  return withTx(undefined, async (tx) => {
    const itemsDelta: Record<string, { spec: string; qty: number }> = {};
    for (const it of items) itemsDelta[it.category_code] = { spec: it.description, qty: it.qty };
    const draft = await createDraftRevision(cr.unit_id, { kind: "CUSTOMISATION", change_request_id: crId, items_delta: itemsDelta, note: `${cr.code}: ${cr.title}` }, tx, actorFields(ctx));
    const revision = await releaseRevision(draft.id, tx, actorFields(ctx));

    if (cr.exception_id) await useException(cr.exception_id, crId, tx);

    for (const it of items) {
      const kind: "SITE_WORK" | "PROCUREMENT" | "VENDOR" | "DRAWING_UPDATE" =
        it.category_code === "structural" || it.category_code === "kitchen_layout" ? "DRAWING_UPDATE" : it.catalogue_item_id && it.lead_days > 0 ? "PROCUREMENT" : it.vendor_cost_inr > 0 ? "VENDOR" : "SITE_WORK";
      const actionId = await createAction({
        type: "exec_simple", title: `${kind.replace("_", " ")}: ${it.description} (${cr.code})`, project_id: cr.project_id,
        source_module: "change_requests", source_entity_type: "change_request", source_entity_id: crId,
        booking_id: cr.booking_id, unit_id: cr.unit_id, owner_role: "SITE", origin: "AUTO",
      }, tx);
      await tx.query(`INSERT INTO cr_execution_action (cr_id, action_id, kind) VALUES ($1,$2,$3)`, [crId, actionId, kind]);
      await tx.query(`UPDATE action SET status = 'In Progress' WHERE id = $1`, [actionId]);
      await tx.query(`UPDATE change_request_item SET status = 'APPROVED' WHERE id = $1`, [it.id]);
    }

    await tx.query(`UPDATE change_request SET status = 'IN_PROGRESS', released_at = now(), released_by = $2, spec_revision_id = $3, updated_at = now() WHERE id = $1`, [crId, ctx.actor.user_id, revision.id]);
    await appendEvent(tx, { type: "change_request.released", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { spec_revision_id: revision.id, execution_actions: items.length, exception_consumed: cr.exception_id }, ...actorFields(ctx) });
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "APPROVED", to: "IN_PROGRESS" } });
    return loadCr(crId, tx);
  });
}
