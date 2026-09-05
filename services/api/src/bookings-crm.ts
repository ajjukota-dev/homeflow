import { randomUUID } from "node:crypto";
import { db } from "./db";
import { setupFunding } from "./demands-schedule";
import { getBooking } from "./bookings";
import { appendEvent, withTx } from "./events";
import { nextCode } from "./model/codes";
import { authorize } from "./authz/authorize";
import type { Ctx } from "./authz/types";

// CRM decisions on a submitted booking — split out of bookings.ts to respect the 200-line
// rule (Sales → CRM handoff, handshakes.md H2).

/** CRM accepts → Customer Twin is created and linked; unit becomes booked.
 *  Emits sales_handover.accepted (Appendix B) plus the canonical-model events (04 rule 8). */
export async function acceptBooking(id: string, ctx: Ctx, rm = "Priya Nair") {
  await authorize(ctx, "sales_handover", "WRITE");
  const b = await db.query<{ unit_id: string; status: string; project_id: string }>(
    `SELECT unit_id, status, project_id FROM booking WHERE id = $1`,
    [id]
  );
  if (b.rows.length === 0) throw new Error("not_found");
  if (b.rows[0].status !== "submitted") throw new Error("not_submitted");
  const { unit_id: unitId, project_id: projectId } = b.rows[0];

  const app = await db.query<{ id: string; display_name: string; phone: string }>(
    `SELECT id, display_name, phone FROM booking_applicant WHERE booking_id = $1 AND role = 'primary'`,
    [id]
  );
  const a = app.rows[0];
  const custId = randomUUID();
  await withTx(undefined, async (t) => {
    const custCode = await nextCode(t, "CUS");
    await t.query(
      `INSERT INTO customer (id, display_name, primary_phone, kyc_status, code, primary_name)
       VALUES ($1,$2,$3,'verified',$4,$2)`,
      [custId, a.display_name, a.phone, custCode]
    );
    await appendEvent(t, {
      type: "customer.created",
      entity_type: "customer",
      entity_id: custId,
      project_id: projectId,
      booking_id: id,
      customer_id: custId,
      payload: { display_name: a.display_name },
    });
    await t.query(`UPDATE booking_applicant SET customer_id = $1 WHERE id = $2`, [custId, a.id]);
    await t.query(`UPDATE booking SET status = 'active', rm_owner = $1 WHERE id = $2`, [rm, id]);
    await appendEvent(t, {
      type: "booking.status_changed",
      entity_type: "booking",
      entity_id: id,
      project_id: projectId,
      booking_id: id,
      unit_id: unitId,
      payload: { from: "submitted", to: "active" },
    });
    await appendEvent(t, {
      type: "sales_handover.accepted",
      entity_type: "booking",
      entity_id: id,
      project_id: projectId,
      booking_id: id,
      unit_id: unitId,
      payload: { rm_owner: rm },
    });
    await t.query(`UPDATE unit SET sale_status = 'booked' WHERE id = $1`, [unitId]);
    await appendEvent(t, {
      type: "unit.sale_status_changed",
      entity_type: "unit",
      entity_id: unitId,
      project_id: projectId,
      unit_id: unitId,
      payload: { from: "held", to: "booked" },
    });
    await setupFunding(id, t);
  });
  return { booking: await getBooking(id), customer_id: custId };
}

/** CRM returns an incomplete file. Emits sales_handover.returned (Appendix B). */
export async function returnBooking(id: string, reason: string, ctx: Ctx) {
  await authorize(ctx, "sales_handover", "WRITE");
  const b = await db.query<{ unit_id: string; project_id: string }>(
    `SELECT unit_id, project_id FROM booking WHERE id = $1`,
    [id]
  );
  if (b.rows.length === 0) throw new Error("not_found");
  const { unit_id: unitId, project_id: projectId } = b.rows[0];
  await withTx(undefined, async (t) => {
    await t.query(`UPDATE booking SET status = 'returned', return_reason = $1 WHERE id = $2`, [reason, id]);
    await appendEvent(t, {
      type: "booking.status_changed",
      entity_type: "booking",
      entity_id: id,
      project_id: projectId,
      booking_id: id,
      unit_id: unitId,
      payload: { from: "submitted", to: "returned", reason },
    });
    await appendEvent(t, {
      type: "sales_handover.returned",
      entity_type: "booking",
      entity_id: id,
      project_id: projectId,
      booking_id: id,
      unit_id: unitId,
      payload: { reason },
    });
    await t.query(`UPDATE unit SET sale_status = 'available' WHERE id = $1`, [unitId]);
    await appendEvent(t, {
      type: "unit.sale_status_changed",
      entity_type: "unit",
      entity_id: unitId,
      project_id: projectId,
      unit_id: unitId,
      payload: { from: "held", to: "available" },
    });
  });
  return getBooking(id);
}
