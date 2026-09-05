import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { todayIst } from "../authz/clock";
import { nextCode } from "../model/codes";
import { evaluateUnit } from "../changeability/core";
import { loadPolicy, loadCr, assertCrActor, CR_SELECT, type CrRow } from "./store";

// 18 rules 1-2: capture never blocked; feasibility review.
//
// Rule 1's routing ("a request in a category whose gate is HARD_CLOSED/EXCEPTION_ONLY") reads as
// per-item, but the state machine puts FEASIBILITY_REVIEW before any change_request_item exists
// (items are added at COSTING). The Screens section resolves this: the portal's raise flow is a
// "category picker (shows only customer-visible categories with state labels)" — the customer
// picks a category before typing details, so this file's `primary_category_code` (store.ts's
// documented addition) carries that pick and is what rule 1 routes on at capture time.

export const CUSTOMISATION_DESK_ROLES = ["CUSTOMISATION", "MANAGEMENT", "SUPER_ADMIN"];
const FEASIBILITY_ROLES = ["CUSTOMISATION", "SITE", "MANAGEMENT", "SUPER_ADMIN"];

export interface RaiseCrInput {
  booking_id: string;
  title: string;
  summary?: string | null;
  primary_category_code?: string | null;
  raised_by_kind: "CUSTOMER_PORTAL" | "SALES" | "CRM" | "CUSTOMISATION";
}

async function primaryApplicantCustomerId(bookingId: string, tx: DbLike): Promise<string | null> {
  const r = await tx.query<{ customer_id: string | null }>(
    `SELECT customer_id FROM booking_applicant WHERE booking_id = $1 ORDER BY (role <> 'primary'), id LIMIT 1`,
    [bookingId]
  );
  return r.rows[0]?.customer_id ?? null;
}

/** Rule 1: capture is never blocked by a closed gate — it is routed. */
export async function raiseChangeRequest(input: RaiseCrInput, ctx: Ctx): Promise<CrRow> {
  if (ctx.actor.kind === "CUSTOMER") {
    const own = (await db.query<{ booking_id: string }>(`SELECT booking_id FROM customer_login WHERE user_id = $1`, [ctx.actor.user_id])).rows[0]?.booking_id;
    if (own !== input.booking_id) throw new AppError("forbidden", "customers may raise a request only on their own booking");
  } else {
    requireRole(ctx, STAFF_ROLES);
  }
  if (!input.title?.trim()) throw new AppError("validation", "title is required", "title");

  const booking = (await db.query<{ project_id: string; unit_id: string }>(`SELECT project_id, unit_id FROM booking WHERE id = $1`, [input.booking_id])).rows[0];
  if (!booking) throw new AppError("not_found", "booking not found");

  const matrix = await evaluateUnit(booking.unit_id, { trigger: "change_request_captured" });
  const gateSummary: Record<string, string> = {};
  for (const g of matrix.gates) gateSummary[g.category_code] = g.state;
  const gateAtRequest = input.primary_category_code ? gateSummary[input.primary_category_code] ?? null : null;

  const policy = await loadPolicy(booking.project_id);
  const freezeDate = input.primary_category_code ? policy.freeze_dates[input.primary_category_code] : undefined;
  const freezeState: "PRE_FREEZE" | "POST_FREEZE" = freezeDate && todayIst() >= freezeDate ? "POST_FREEZE" : "PRE_FREEZE";

  const id = "cr_" + randomUUID().slice(0, 8);
  const cr = await withTx(undefined, async (tx) => {
    const code = await nextCode(tx, "CR");
    const customerId = await primaryApplicantCustomerId(input.booking_id, tx);
    await tx.query(
      `INSERT INTO change_request (id, code, booking_id, unit_id, project_id, customer_id, raised_by_kind, raised_by_user_id, title, summary,
        primary_category_code, freeze_state_at_request, gate_summary_at_request, owner_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
      [id, code, input.booking_id, booking.unit_id, booking.project_id, customerId, input.raised_by_kind,
        ctx.actor.kind === "CUSTOMER" ? null : ctx.actor.user_id, input.title.trim(), input.summary ?? null,
        input.primary_category_code ?? null, freezeState, JSON.stringify(gateSummary), null]
    );
    await appendEvent(tx, {
      type: "change_request.created", entity_type: "change_request", entity_id: id, project_id: booking.project_id, unit_id: booking.unit_id, booking_id: input.booking_id,
      payload: { code, title: input.title.trim(), primary_category_code: input.primary_category_code ?? null, gate_at_request: gateAtRequest, freeze_state: freezeState }, ...actorFields(ctx),
    });

    if (gateAtRequest === "HARD_CLOSED") {
      // Auto NOT_FEASIBLE — a draft customer-facing reason is stored on the CR for CRM to review
      // and send via 29 (communications, not built) before publishing; never auto-sent (rule 1).
      await recordFeasibilityCore(id, {
        result: "NOT_FEASIBLE",
        technical_notes: `${input.primary_category_code} is HARD_CLOSED for this unit and cannot be reopened by exception.`,
        reviewer: null,
      }, null, tx);
    } else {
      await tx.query(`UPDATE change_request SET status = 'FEASIBILITY_REVIEW', updated_at = now() WHERE id = $1`, [id]);
      await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: id, project_id: booking.project_id, booking_id: input.booking_id, payload: { from: "REQUESTED", to: "FEASIBILITY_REVIEW" } });
    }
    return loadCr(id, tx);
  });
  return cr;
}

interface FeasibilityInput { result: "FEASIBLE" | "FEASIBLE_WITH_CONDITIONS" | "NOT_FEASIBLE"; technical_notes: string; reviewer: string | null }

async function recordFeasibilityCore(crId: string, input: FeasibilityInput, ctx: Ctx | null, tx: DbLike): Promise<void> {
  const cr = await loadCr(crId, tx);
  const feasibility = { ...input, at: new Date().toISOString() };
  const nextStatus = input.result === "NOT_FEASIBLE" ? "REJECTED" : "COSTING";
  await tx.query(`UPDATE change_request SET feasibility = $2::jsonb, status = $3, updated_at = now() WHERE id = $1`, [crId, JSON.stringify(feasibility), nextStatus]);
  await appendEvent(tx, {
    type: "change_request.feasibility_recorded", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id,
    payload: { result: input.result, technical_notes: input.technical_notes }, ...(ctx ? actorFields(ctx) : {}),
  });
  await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "FEASIBILITY_REVIEW", to: nextStatus } });
}

/** Rule 2: human feasibility review (Customisation/Site) — NOT_FEASIBLE rejects with a
 *  customer-facing reason CRM edits before publish (29, not built — text is stored, never sent). */
export async function recordFeasibility(crId: string, input: Omit<FeasibilityInput, "reviewer">, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, FEASIBILITY_ROLES);
  const cr = await loadCr(crId);
  if (cr.status !== "FEASIBILITY_REVIEW") throw new AppError("conflict", `change request is ${cr.status}, not FEASIBILITY_REVIEW`);
  if (!input.technical_notes?.trim()) throw new AppError("validation", "technical_notes is required", "technical_notes");
  await withTx(undefined, (tx) => recordFeasibilityCore(crId, { ...input, reviewer: ctx.actor.user_id }, ctx, tx));
  return loadCr(crId);
}

export async function getChangeRequest(id: string, ctx: Ctx): Promise<CrRow> {
  const cr = await loadCr(id);
  await assertCrActor(cr, ctx, STAFF_ROLES);
  return cr;
}

export async function listChangeRequests(filter: { status?: string; project_id?: string; owner_user_id?: string; booking_id?: string }, ctx: Ctx): Promise<CrRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const conds: string[] = [];
  const params: unknown[] = [];
  for (const [col, val] of [["status", filter.status], ["project_id", filter.project_id], ["owner_user_id", filter.owner_user_id], ["booking_id", filter.booking_id]] as const) {
    if (val) { params.push(val); conds.push(`${col} = $${params.length}`); }
  }
  const r = await db.query<CrRow>(`${CR_SELECT} ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY created_at DESC`, params);
  return r.rows;
}

export async function withdrawChangeRequest(crId: string, ctx: Ctx): Promise<CrRow> {
  const cr = await loadCr(crId);
  await assertCrActor(cr, ctx, CUSTOMISATION_DESK_ROLES);
  const withdrawable: string[] = ["REQUESTED", "FEASIBILITY_REVIEW", "COSTING", "AWAITING_APPROVAL", "AWAITING_CUSTOMER", "AWAITING_PAYMENT", "APPROVED"];
  if (!withdrawable.includes(cr.status)) throw new AppError("conflict", `${cr.status} can no longer be withdrawn by the customer — it is released`);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_request SET status = 'WITHDRAWN', updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: cr.status, to: "WITHDRAWN" }, ...actorFields(ctx) });
  });
  return loadCr(crId);
}
