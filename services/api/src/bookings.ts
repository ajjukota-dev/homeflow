import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { BookingDetailRow, BookingListRow } from "./bookings-types";
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

// CRM accept/return moved to bookings-crm.ts, and the customer directory to
// model/customers.ts, to keep this file under the 200-line rule — re-exported so every
// existing `from "./bookings"` import keeps working unchanged.
export { acceptBooking, returnBooking } from "./bookings-crm";
export { listCustomers, getCustomer } from "./model/customers";
