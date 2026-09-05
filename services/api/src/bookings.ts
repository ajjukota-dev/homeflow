import { randomUUID } from "node:crypto";
import { db } from "./db";
import { setupFunding } from "./demands-schedule";
import type { BookingDetailRow, BookingListRow, CustomerListRow, CustomerRow } from "./bookings-types";
import { appendEvent, withTx } from "./events";

// Sales → CRM handoff (handshakes.md H2). Completeness gate → accept births a Customer Twin.

export const MANDATORY_DOCS = ["PAN card", "Address proof", "Photograph"];

export interface BookingInput {
  applicant: { display_name: string; phone: string; pan: string };
  total_consideration: number;
  docs: { type: string; received: boolean }[];
}

/** The completeness gate — CRM cannot accept an incomplete file (Module 8.1). */
export function assessCompleteness(input: BookingInput): { score: number; missing: string[] } {
  const checks = [
    { key: "Applicant name", ok: !!input.applicant?.display_name?.trim() },
    { key: "Phone", ok: /^\d{10}$/.test(input.applicant?.phone ?? "") },
    { key: "PAN", ok: /^[A-Z]{5}\d{4}[A-Z]$/i.test(input.applicant?.pan ?? "") },
    { key: "Consideration", ok: (input.total_consideration ?? 0) > 0 },
    ...MANDATORY_DOCS.map((d) => ({
      key: d,
      ok: !!input.docs?.find((x) => x.type === d && x.received),
    })),
  ];
  const present = checks.filter((c) => c.ok).length;
  return {
    score: Math.round((present / checks.length) * 100),
    missing: checks.filter((c) => !c.ok).map((c) => c.key),
  };
}

export async function getBooking(id: string) {
  const r = await db.query<BookingDetailRow>(
    `SELECT b.id, b.booking_number, b.status, b.total_consideration::float8 AS total_consideration,
            b.completeness_score, b.return_reason, b.rm_owner,
            u.unit_number, u.unit_type, u.facing,
            a.display_name AS applicant_name, a.phone AS applicant_phone, a.pan AS applicant_pan
       FROM booking b JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/** Sales creates the booking; blocked unless the completeness gate is satisfied. */
export async function createBooking(unitId: string, input: BookingInput) {
  const u = await db.query<{ project_id: string; sale_status: string }>(
    `SELECT project_id, sale_status FROM unit WHERE id = $1`,
    [unitId]
  );
  if (u.rows.length === 0) throw new Error("unit_not_found");
  if (u.rows[0].sale_status !== "available") throw new Error("unit_not_available");

  const { score, missing } = assessCompleteness(input);
  if (score < 100) {
    const err = new Error("incomplete") as Error & { missing: string[] };
    err.missing = missing;
    throw err;
  }

  const bookingId = randomUUID();
  const number = "BK-" + bookingId.slice(0, 8).toUpperCase();
  await withTx(undefined, async (t) => {
    await t.query(
      `INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score, docs)
       VALUES ($1,$2,$3,$4,'submitted',$5,$6,$7)`,
      [bookingId, u.rows[0].project_id, unitId, number, input.total_consideration, score, JSON.stringify(input.docs)]
    );
    await t.query(
      `INSERT INTO booking_applicant (id, booking_id, display_name, role, phone, pan)
       VALUES ($1,$2,$3,'primary',$4,$5)`,
      [randomUUID(), bookingId, input.applicant.display_name, input.applicant.phone, input.applicant.pan]
    );
    await t.query(`UPDATE unit SET sale_status = 'held' WHERE id = $1`, [unitId]);
    await appendEvent(t, {
      type: "booking.created",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: u.rows[0].project_id,
      booking_id: bookingId,
      unit_id: unitId,
      payload: { booking_number: number, total_consideration: input.total_consideration },
    });
    await appendEvent(t, {
      type: "sales_handover.submitted",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: u.rows[0].project_id,
      booking_id: bookingId,
      unit_id: unitId,
      payload: { completeness_score: score },
    });
    await appendEvent(t, {
      type: "unit.sale_status_changed",
      entity_type: "unit",
      entity_id: unitId,
      project_id: u.rows[0].project_id,
      unit_id: unitId,
      payload: { from: u.rows[0].sale_status, to: "held" },
    });
  });
  return getBooking(bookingId);
}

export async function listBookings(status?: string) {
  const r = await db.query<BookingListRow>(
    `SELECT b.id, b.booking_number, b.status, b.total_consideration::float8 AS total_consideration,
            b.completeness_score, b.return_reason,
            u.unit_number, u.unit_type,
            a.display_name AS applicant_name, a.phone AS applicant_phone
       FROM booking b JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
       ${status ? "WHERE b.status = $1" : ""}
      ORDER BY b.created_at DESC`,
    status ? [status] : []
  );
  return r.rows;
}

/** CRM accepts → Customer Twin is created and linked; unit becomes booked.
 *  Emits sales_handover.accepted (Appendix B) plus the canonical-model events (04 rule 8). */
export async function acceptBooking(id: string, rm = "Priya Nair") {
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
    await t.query(
      `INSERT INTO customer (id, display_name, primary_phone, kyc_status) VALUES ($1,$2,$3,'verified')`,
      [custId, a.display_name, a.phone]
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
export async function returnBooking(id: string, reason: string) {
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

export async function listCustomers() {
  const r = await db.query<CustomerListRow>(
    `SELECT c.id, c.display_name, c.primary_phone, c.kyc_status, b.booking_number, u.unit_number
       FROM customer c
       JOIN booking_applicant a ON a.customer_id = c.id
       JOIN booking b ON b.id = a.booking_id
       JOIN unit u ON u.id = b.unit_id
      ORDER BY c.created_at DESC`
  );
  return r.rows;
}

export async function getCustomer(id: string) {
  const c = await db.query<CustomerRow>(`SELECT * FROM customer WHERE id = $1`, [id]);
  if (c.rows.length === 0) return null;
  const bookings = await db.query<{
    booking_number: string;
    status: string;
    total_consideration: number;
    unit_number: string;
    unit_type: string;
    facing: string;
  }>(
    `SELECT b.booking_number, b.status, b.total_consideration::float8 AS total_consideration,
            u.unit_number, u.unit_type, u.facing
       FROM booking b
       JOIN booking_applicant a ON a.booking_id = b.id
       JOIN unit u ON u.id = b.unit_id
      WHERE a.customer_id = $1`,
    [id]
  );
  return { ...c.rows[0], bookings: bookings.rows };
}
