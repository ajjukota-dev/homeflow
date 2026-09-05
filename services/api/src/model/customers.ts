import { db } from "../db";
import type { CustomerListRow, CustomerRow } from "../bookings-types";
import { appendEvent, withTx, type DbLike } from "../events";
import { ValidationError } from "./derive";
import { authorize } from "../authz/authorize";
import type { Ctx } from "../authz/types";

// Customer directory (CRM-side) — split out of bookings.ts to respect the 200-line rule.
// Portal-facing projection (My Pranava Home) lives in ../customer.ts; this is the workspace view.

export type Residency = "RESIDENT" | "NRI" | "OCI";

export async function listCustomers(ctx: Ctx) {
  await authorize(ctx, "customer_overview", "READ");
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

// `ctx` optional: also called internally by mergePreview (already authorized above it).
export async function getCustomer(id: string, ctx?: Ctx) {
  if (ctx) await authorize(ctx, "customer_overview", "READ");
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

/** Merge preview — what a merge would change, shown before the customer confirms it. */
export async function mergePreview(fromId: string, intoId: string, ctx: Ctx) {
  await authorize(ctx, "customer_overview", "READ");
  const [from, into] = await Promise.all([getCustomer(fromId), getCustomer(intoId)]);
  if (!from) throw new ValidationError("from customer not found");
  if (!into) throw new ValidationError("into customer not found");
  return { from, into, bookings_to_repoint: from.bookings.length };
}

/** POST /customers/:id/merge — dedupe preserving history (04 rule 5, p27 §22).
 *  `fromId` is marked merged_into_customer_id = intoId; both codes survive. */
export async function mergeCustomer(fromId: string, intoId: string, ctx: Ctx): Promise<void> {
  await authorize(ctx, "customer_overview", "WRITE");
  if (fromId === intoId) throw new ValidationError("cannot merge a customer into itself");
  const rows = await db.query<{ id: string; merged_into_customer_id: string | null }>(
    `SELECT id, merged_into_customer_id FROM customer WHERE id IN ($1, $2)`,
    [fromId, intoId]
  );
  const from = rows.rows.find((r) => r.id === fromId);
  const into = rows.rows.find((r) => r.id === intoId);
  if (!from) throw new ValidationError("from customer not found");
  if (!into) throw new ValidationError("into customer not found");
  if (from.merged_into_customer_id) throw new ValidationError("from customer is already merged");

  await withTx(undefined, async (t) => {
    await t.query(`UPDATE customer SET merged_into_customer_id = $1 WHERE id = $2`, [intoId, fromId]);
    // Re-point applicant rows so booking history is queryable from the surviving customer —
    // the merged customer's own row (and its code) stays, satisfying "keeps both codes in history".
    await t.query(`UPDATE booking_applicant SET customer_id = $1 WHERE customer_id = $2`, [intoId, fromId]);
    await appendEvent(t, {
      type: "customer.merged",
      entity_type: "customer",
      entity_id: fromId,
      customer_id: intoId,
      payload: { from: fromId, into: intoId },
    });
  });
}

/** Changing residency after CRM acceptance emits customer.residency_changed (04 rule 6). */
export async function updateCustomerResidency(
  customerId: string,
  residency: Residency,
  ctx: Ctx,
  handle?: DbLike
): Promise<void> {
  await authorize(ctx, "customer_overview", "WRITE");
  const current = await db.query<{ residency: string }>(`SELECT residency FROM customer WHERE id = $1`, [
    customerId,
  ]);
  if (current.rows.length === 0) throw new ValidationError("customer_not_found");
  if (current.rows[0].residency === residency) return;

  const acceptedBooking = await db.query<{ id: string; project_id: string }>(
    `SELECT b.id, b.project_id FROM booking b
       JOIN booking_applicant a ON a.booking_id = b.id
      WHERE a.customer_id = $1 AND b.status IN ('active', 'registered', 'handed_over') LIMIT 1`,
    [customerId]
  );

  await withTx(handle, async (t) => {
    await t.query(`UPDATE customer SET residency = $1 WHERE id = $2`, [residency, customerId]);
    if (acceptedBooking.rows.length > 0) {
      await appendEvent(t, {
        type: "customer.residency_changed",
        entity_type: "customer",
        entity_id: customerId,
        project_id: acceptedBooking.rows[0].project_id,
        booking_id: acceptedBooking.rows[0].id,
        customer_id: customerId,
        payload: { from: current.rows[0].residency, to: residency },
      });
    }
  });
}
