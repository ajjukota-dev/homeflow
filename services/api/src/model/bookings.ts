import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { ValidationError } from "./derive";
import { nextCode } from "./codes";
import {
  assertBookingTransition,
  toDbBookingStatus,
  toSpecBookingStatus,
  type BookingStatus,
} from "./status";
import { requireRole, BOOKING_ADMIN_ROLES } from "../authz/requireRole";
import type { Ctx } from "../authz/types";

// Booking lifecycle beyond create/accept/return (which predate this spec, in ../bookings.ts
// and ../bookings-crm.ts): confirm/cancel/transfer (04 §API, rule 3).

async function currentStatus(bookingId: string, handle: DbLike = db): Promise<{
  status: BookingStatus;
  unit_id: string;
  project_id: string;
}> {
  const r = await handle.query<{ status: string; unit_id: string; project_id: string }>(
    `SELECT status, unit_id, project_id FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (r.rows.length === 0) throw new ValidationError("booking_not_found");
  return { ...r.rows[0], status: toSpecBookingStatus(r.rows[0].status) };
}

/** DRAFT → CONFIRMED (04 §API `POST /bookings/:id/confirm`). */
export async function confirmBooking(bookingId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, BOOKING_ADMIN_ROLES);
  const { status, project_id: projectId, unit_id: unitId } = await currentStatus(bookingId);
  assertBookingTransition(status, "CONFIRMED");
  await withTx(undefined, async (t) => {
    await t.query(`UPDATE booking SET status = $1 WHERE id = $2`, [toDbBookingStatus("CONFIRMED"), bookingId]);
    await appendEvent(t, {
      type: "booking.status_changed",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: projectId,
      booking_id: bookingId,
      unit_id: unitId,
      payload: { from: status, to: "CONFIRMED" },
      ...actorFields(ctx),
    });
  });
}

/** CANCELLED from any non-terminal state; requires a reason (04 rule 3). Unit → AVAILABLE. */
export async function cancelBooking(bookingId: string, reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, BOOKING_ADMIN_ROLES);
  if (!reason?.trim()) throw new ValidationError("cancellation reason required", "reason");
  const { status, project_id: projectId, unit_id: unitId } = await currentStatus(bookingId);
  assertBookingTransition(status, "CANCELLED");
  await withTx(undefined, async (t) => {
    await t.query(
      `UPDATE booking SET status = $1, cancellation_reason = $2, cancelled_at = now() WHERE id = $3`,
      [toDbBookingStatus("CANCELLED"), reason.trim(), bookingId]
    );
    await appendEvent(t, {
      type: "booking.status_changed",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: projectId,
      booking_id: bookingId,
      unit_id: unitId,
      payload: { from: status, to: "CANCELLED", reason: reason.trim() },
      ...actorFields(ctx),
    });
    await t.query(`UPDATE unit SET sale_status = 'available' WHERE id = $1`, [unitId]);
    await appendEvent(t, {
      type: "unit.sale_status_changed",
      entity_type: "unit",
      entity_id: unitId,
      project_id: projectId,
      unit_id: unitId,
      payload: { to: "AVAILABLE", reason: "booking_cancelled" },
      ...actorFields(ctx),
    });
  });
}

/** TRANSFERRED from ACTIVE/REGISTERED — creates a successor booking with
 *  predecessor_booking_id (04 rule 3), continuing the sale under a new customer. The unit
 *  keeps its sale_status (still booked/registered under the new owner); only the booking
 *  and its applicants change — the caller sets applicants via PUT /bookings/:id/applicants. */
export async function transferBooking(bookingId: string, reason: string, ctx: Ctx): Promise<string> {
  requireRole(ctx, BOOKING_ADMIN_ROLES);
  if (!reason?.trim()) throw new ValidationError("transfer reason required", "reason");
  const b = await db.query<{
    status: string;
    project_id: string;
    unit_id: string;
    total_consideration: string;
    payment_plan_id: string | null;
  }>(`SELECT status, project_id, unit_id, total_consideration, payment_plan_id FROM booking WHERE id = $1`, [
    bookingId,
  ]);
  if (b.rows.length === 0) throw new ValidationError("booking_not_found");
  const from = toSpecBookingStatus(b.rows[0].status);
  assertBookingTransition(from, "TRANSFERRED");
  const { project_id: projectId, unit_id: unitId } = b.rows[0];

  const successorId = randomUUID();
  return withTx(undefined, async (t) => {
    await t.query(
      `UPDATE booking SET status = $1, cancellation_reason = $2, cancelled_at = now() WHERE id = $3`,
      [toDbBookingStatus("TRANSFERRED"), reason.trim(), bookingId]
    );
    await appendEvent(t, {
      type: "booking.status_changed",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: projectId,
      booking_id: bookingId,
      unit_id: unitId,
      payload: { from, to: "TRANSFERRED", reason: reason.trim() },
      ...actorFields(ctx),
    });

    const code = await nextCode(t, "BKG");
    const number = "BK-" + successorId.slice(0, 8).toUpperCase();
    await t.query(
      `INSERT INTO booking
        (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score,
         payment_plan_id, predecessor_booking_id, code, agreement_value_inr)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$6)`,
      [
        successorId,
        projectId,
        unitId,
        number,
        toDbBookingStatus("ACTIVE"),
        b.rows[0].total_consideration,
        b.rows[0].payment_plan_id,
        bookingId,
        code,
      ]
    );
    await appendEvent(t, {
      type: "booking.created",
      entity_type: "booking",
      entity_id: successorId,
      project_id: projectId,
      booking_id: successorId,
      unit_id: unitId,
      payload: { booking_number: number, predecessor_booking_id: bookingId },
      ...actorFields(ctx),
    });
    await appendEvent(t, {
      type: "booking.transferred",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: projectId,
      booking_id: bookingId,
      unit_id: unitId,
      payload: { successor_booking_id: successorId, reason: reason.trim() },
      ...actorFields(ctx),
    });
    return successorId;
  });
}
