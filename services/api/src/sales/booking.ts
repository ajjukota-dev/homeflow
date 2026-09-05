import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { toDbBookingStatus, toSpecBookingStatus } from "../model/status";
import { requiredApprovers } from "../approvals/matrix";
import { createAction } from "../actions/core";
import type { Residency } from "../model/customers";
import { loadProspect, needsForProspect } from "./prospects";
import { consumeHoldsForBooking } from "./holds";

// 24-sales-inventory-discovery.md rule 8 — booking from inventory. Additive next to the pre-24
// `bookings.ts::createBooking` (17 test files depend on its 'submitted' + docs-completeness shape):
// this path creates the 04 DRAFT booking with applicants as customer rows (residency captured),
// price/discount, payment plan, a discount-approval action when 25's matrix says so, and copies
// the prospect's needs onto the booking for 18. CONFIRMED via 04's confirmBooking or the
// payment.received subscriber (sales/subscribers.ts).

const RESIDENCIES: Residency[] = ["RESIDENT", "NRI", "OCI"];

export interface BookFromInventoryInput {
  unit_id: string;
  applicants: { display_name: string; phone?: string | null; email?: string | null; pan?: string | null; residency: Residency; role?: "PRIMARY" | "CO_APPLICANT" }[];
  price_inr: number;
  discount_inr?: number | null;
  booking_amount_inr?: number | null;
  payment_plan_id?: string | null;
}

export interface BookingCreated {
  booking_id: string;
  code: string;
  status: string;
  unit_id: string;
  prospect_id: string;
  agreement_value_inr: number;
  discount_inr: number;
  approval_action_id: string | null;
  consumed_hold_ids: string[];
  personalisation_context: unknown[];
}

export async function bookFromInventory(prospectId: string, input: BookFromInventoryInput, ctx: Ctx): Promise<BookingCreated> {
  await authorize(ctx, "sales_handover", "WRITE"); // the same gate the pre-24 booking path uses
  const prospect = await loadProspect(prospectId);
  if (prospect.status !== "ACTIVE") throw new AppError("conflict", `prospect is ${prospect.status}`);
  if (!Array.isArray(input.applicants) || input.applicants.length === 0) throw new AppError("validation", "at least one applicant is required", "applicants");
  const primaries = input.applicants.filter((a) => (a.role ?? "PRIMARY") === "PRIMARY");
  if (primaries.length !== 1) throw new AppError("validation", "exactly one PRIMARY applicant is required", "applicants");
  for (const a of input.applicants) {
    if (!a.display_name?.trim()) throw new AppError("validation", "applicant display_name is required", "applicants");
    if (!RESIDENCIES.includes(a.residency)) throw new AppError("validation", `residency must be one of ${RESIDENCIES.join("/")}`, "applicants");
  }
  if (!(input.price_inr > 0)) throw new AppError("validation", "price_inr must be positive", "price_inr");
  const discount = input.discount_inr ?? 0;
  if (discount < 0 || discount >= input.price_inr) throw new AppError("validation", "discount_inr must be between 0 and the price", "discount_inr");

  const unit = (await db.query<{ project_id: string; sale_status: string }>(`SELECT project_id, sale_status FROM unit WHERE id = $1`, [input.unit_id])).rows[0];
  if (!unit) throw new AppError("not_found", "unit not found");
  if (unit.project_id !== prospect.project_id) throw new AppError("validation", "unit belongs to a different project than the prospect", "unit_id");
  if (unit.sale_status !== "available") {
    const heldByProspect = await db.query<{ id: string }>(
      `SELECT id FROM change_window_hold WHERE unit_id = $1 AND prospect_id = $2 AND status = 'APPROVED'`,
      [input.unit_id, prospectId]
    );
    if (unit.sale_status !== "held" || heldByProspect.rows.length === 0) throw new AppError("conflict", `unit is ${unit.sale_status.toUpperCase()} and not held by this prospect`);
  }
  if (input.payment_plan_id) {
    const plan = await db.query<{ id: string }>(`SELECT id FROM payment_plan WHERE id = $1 AND (project_id = $2 OR project_id IS NULL)`, [input.payment_plan_id, unit.project_id]);
    if (!plan.rows[0]) throw new AppError("validation", "unknown payment plan for this project", "payment_plan_id");
  }

  const bookingId = randomUUID();
  const needs = await needsForProspect(prospectId);
  return withTx(undefined, async (tx) => {
    const code = await nextCode(tx, "BKG");
    await tx.query(
      `INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score, docs, code, agreement_value_inr, booking_amount_inr,
                            sales_owner_user_id, payment_plan_id, prospect_id, discount_inr, personalisation_context)
       VALUES ($1,$2,$3,$4,$5,$6,0,'[]',$7,$6,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        bookingId, unit.project_id, input.unit_id, "BK-" + bookingId.slice(0, 8).toUpperCase(), toDbBookingStatus("DRAFT"), input.price_inr - discount, code,
        input.booking_amount_inr ?? null, ctx.actor.user_id, input.payment_plan_id ?? null, prospectId, discount, JSON.stringify(needs),
      ]
    );
    // action.booking_id FKs the booking, so the approval action follows the row.
    const approvalActionId = await discountApproval(bookingId, unit.project_id, discount, tx);
    if (approvalActionId) await tx.query(`UPDATE booking SET approval_action_id = $2 WHERE id = $1`, [bookingId, approvalActionId]);
    let primaryCustomerId: string | null = null;
    let sort = 0;
    for (const a of input.applicants) {
      sort += 1;
      const customerId = "c_" + randomUUID().slice(0, 8);
      const custCode = await nextCode(tx, "CUS");
      await tx.query(
        `INSERT INTO customer (id, display_name, primary_phone, primary_email, kyc_status, code, primary_name, pan, residency)
         VALUES ($1,$2,$3,$4,'pending',$5,$2,$6,$7)`,
        [customerId, a.display_name.trim(), a.phone ?? null, a.email ?? null, custCode, a.pan ?? null, a.residency]
      );
      await appendEvent(tx, { type: "customer.created", entity_type: "customer", entity_id: customerId, project_id: unit.project_id, customer_id: customerId, payload: { code: custCode, residency: a.residency, via: "inventory_booking" }, ...actorFields(ctx) });
      // 0003's CHECK: the legacy lowercase 'primary' plus uppercase CO_APPLICANT/POA/NOMINEE.
      const role = (a.role ?? "PRIMARY") === "PRIMARY" ? "primary" : "CO_APPLICANT";
      if (role === "primary") primaryCustomerId = customerId;
      await tx.query(
        `INSERT INTO booking_applicant (id, booking_id, customer_id, display_name, role, phone, pan, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), bookingId, customerId, a.display_name.trim(), role, a.phone ?? null, a.pan ?? null, sort]
      );
    }
    await tx.query(`UPDATE unit SET sale_status = 'held' WHERE id = $1`, [input.unit_id]);
    await tx.query(`UPDATE prospect SET status = 'BOOKED', customer_id = $2, updated_at = now() WHERE id = $1`, [prospectId, primaryCustomerId]);
    const consumed = await consumeHoldsForBooking(prospectId, input.unit_id, bookingId, tx);
    await appendEvent(tx, {
      type: "booking.created", entity_type: "booking", entity_id: bookingId, project_id: unit.project_id, booking_id: bookingId, unit_id: input.unit_id, customer_id: primaryCustomerId,
      payload: { code, prospect_id: prospectId, price_inr: input.price_inr, discount_inr: discount, approval_required: approvalActionId !== null, via: "inventory" }, ...actorFields(ctx),
    });
    if (unit.sale_status === "available") {
      await appendEvent(tx, { type: "unit.sale_status_changed", entity_type: "unit", entity_id: input.unit_id, project_id: unit.project_id, unit_id: input.unit_id, payload: { from: "available", to: "held" }, ...actorFields(ctx) });
    }
    return {
      booking_id: bookingId, code, status: "DRAFT", unit_id: input.unit_id, prospect_id: prospectId, agreement_value_inr: input.price_inr - discount, discount_inr: discount,
      approval_action_id: approvalActionId, consumed_hold_ids: consumed, personalisation_context: needs,
    };
  });
}

/** Discount beyond 25's matrix → APPROVAL action owned by the band's approver. No band configured
 *  for the value → no approval needed (the matrix's own fail-closed rule applies to the exception
 *  paths that call requiredApprovers directly; a sale with an unconfigured discount band is not
 *  blocked from being captured — same "capture is never blocked" reading 17 took). */
async function discountApproval(bookingId: string, projectId: string, discount: number, tx: DbLike): Promise<string | null> {
  if (discount <= 0) return null;
  let approverRole: string;
  try {
    approverRole = (await requiredApprovers("DISCOUNT", "INR", discount, projectId, tx)).approver_role;
  } catch {
    return null;
  }
  return createAction(
    {
      type: "exec_approval", title: `Discount approval: ₹${discount.toLocaleString("en-IN")} on booking`, project_id: projectId, source_module: "sales",
      source_entity_type: "booking", source_entity_id: bookingId, booking_id: bookingId, owner_role: approverRole, approver_role: approverRole, priority: "HIGH", origin: "AUTO",
    },
    tx
  );
}

/** Whether a DRAFT inventory booking may confirm: its discount approval (if any) must be Closed. */
export async function bookingConfirmBlockers(bookingId: string, tx: DbLike = db): Promise<string[]> {
  const b = await tx.query<{ status: string; approval_action_id: string | null; action_status: string | null }>(
    `SELECT b.status, b.approval_action_id, a.status AS action_status FROM booking b LEFT JOIN action a ON a.id = b.approval_action_id WHERE b.id = $1`,
    [bookingId]
  );
  if (!b.rows[0]) throw new AppError("not_found", "booking not found");
  const blockers: string[] = [];
  if (toSpecBookingStatus(b.rows[0].status) !== "DRAFT") blockers.push(`booking is ${toSpecBookingStatus(b.rows[0].status)}`);
  if (b.rows[0].approval_action_id && b.rows[0].action_status !== "Closed") blockers.push("discount approval pending");
  return blockers;
}

/** Explicit confirm from the Sales screen — 04's transition, gated on the approval. */
export async function confirmInventoryBooking(bookingId: string, ctx: Ctx): Promise<{ status: string }> {
  await authorize(ctx, "sales_handover", "WRITE");
  const blockers = await bookingConfirmBlockers(bookingId);
  if (blockers.length > 0) throw new AppError("conflict", `cannot confirm: ${blockers.join("; ")}`);
  await withTx(undefined, (tx) => confirmDraft(bookingId, tx, actorFields(ctx)));
  return { status: "CONFIRMED" };
}

export async function confirmDraft(bookingId: string, tx: DbLike, actor: { actor_user_id?: string | null; actor_kind?: "USER" | "SYSTEM" | "CUSTOMER" }): Promise<void> {
  const b = (await tx.query<{ project_id: string; unit_id: string }>(`SELECT project_id, unit_id FROM booking WHERE id = $1`, [bookingId])).rows[0]!;
  await tx.query(`UPDATE booking SET status = $2 WHERE id = $1`, [bookingId, toDbBookingStatus("CONFIRMED")]);
  await appendEvent(tx, { type: "booking.status_changed", entity_type: "booking", entity_id: bookingId, project_id: b.project_id, booking_id: bookingId, unit_id: b.unit_id, payload: { from: "DRAFT", to: "CONFIRMED" }, ...actor });
}
