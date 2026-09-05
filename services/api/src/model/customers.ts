import { db } from "../db";
import type { CustomerListRow, CustomerRow } from "../bookings-types";

// Customer directory (CRM-side) — split out of bookings.ts to respect the 200-line rule.
// Portal-facing projection (My Pranava Home) lives in ../customer.ts; this is the workspace view.

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
