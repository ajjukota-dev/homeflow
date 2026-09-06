// 28-360-views.md rule 3 — Booking 360's Overview tab, plus a manifest for the rest (each tab's
// content is owned by its own already-built endpoint — 06/17/19/21/20/22/23/18/13/16/02;
// Communications (29) isn't built yet, so it degrades to a named placeholder per this spec's own
// "Depends on / Feeds" allowance).

import { db } from "../db";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { computeBookingReadiness } from "../scores/booking-readiness";
import { computeHandoverReadiness } from "../scores/handover-readiness";
import { tab, notYetAvailable, type TabManifestEntry } from "./tabs";

export interface NextAction { id: string; title: string; status: string; priority: string; due_at: string | null; owner_role: string }

export interface Booking360View {
  booking_id: string;
  booking_number: string;
  status: string;
  project_id: string;
  unit: { id: string; unit_number: string; unit_type: string } | null;
  customer: { id: string; display_name: string } | null;
  booking_readiness: Awaited<ReturnType<typeof computeBookingReadiness>>;
  handover_readiness: Awaited<ReturnType<typeof computeHandoverReadiness>>;
  next_actions: NextAction[];
  tabs: TabManifestEntry[];
}

export async function getBooking360(bookingId: string, ctx: Ctx): Promise<Booking360View> {
  requireRole(ctx, STAFF_ROLES);
  const b = await db.query<{ booking_number: string; status: string; project_id: string; unit_id: string; unit_number: string; unit_type: string }>(
    `SELECT b.booking_number, b.status, b.project_id, u.id AS unit_id, u.unit_number, u.unit_type
       FROM booking b JOIN unit u ON u.id = b.unit_id WHERE b.id = $1`,
    [bookingId]
  );
  if (!b.rows[0]) throw new AppError("not_found", "not_found");
  const row = b.rows[0];

  const customer = await db.query<{ id: string; display_name: string }>(
    `SELECT c.id, c.display_name FROM booking_applicant a JOIN customer c ON c.id = a.customer_id
      WHERE a.booking_id = $1 AND a.role = 'primary' LIMIT 1`,
    [bookingId]
  );

  const actions = await db.query<NextAction>(
    `SELECT id, title, status, priority, due_at::text AS due_at, owner_role FROM action
      WHERE booking_id = $1 AND status NOT IN ('Closed', 'Cancelled')
      ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, due_at ASC NULLS LAST LIMIT 20`,
    [bookingId]
  );

  const [booking_readiness, handover_readiness] = await Promise.all([
    computeBookingReadiness(bookingId),
    computeHandoverReadiness(bookingId),
  ]);

  return {
    booking_id: bookingId,
    booking_number: row.booking_number,
    status: row.status,
    project_id: row.project_id,
    unit: { id: row.unit_id, unit_number: row.unit_number, unit_type: row.unit_type },
    customer: customer.rows[0] ?? null,
    booking_readiness,
    handover_readiness,
    next_actions: actions.rows,
    tabs: [
      tab("journey", "Journey", `/api/bookings/${bookingId}/journey`),
      tab("sales_handover", "Sales handover", `/api/bookings/${bookingId}/sales-handover`),
      tab("payments", "Payments", `/api/bookings/${bookingId}/demands`),
      tab("legal_registration", "Legal & Registration", `/api/bookings/${bookingId}/registration`),
      tab("customisations", "Customisations", `/api/change-requests?booking_id=${bookingId}`),
      tab("commitments", "Commitments", `/api/bookings/${bookingId}/commitments`),
      customer.rows[0]
        ? tab("communications", "Communications", `/api/customers/${customer.rows[0].id}/communications`)
        : notYetAvailable("communications", "Communications", "no primary applicant on this booking yet — nothing to show"),
      tab("handover", "Handover", `/api/bookings/${bookingId}/handover`),
      tab("documents", "Documents", `/api/bookings/${bookingId}/customer-documents`),
      tab("activity", "Activity", `/api/bookings/${bookingId}/activity`),
    ],
  };
}

/** GET /bookings/:id/activity — same real per-entity event-log slice as unit-360's. */
export async function getBookingActivity(bookingId: string, ctx: Ctx): Promise<{ type: string; occurred_at: string; payload: unknown }[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<{ type: string; occurred_at: string; payload: unknown }>(
    `SELECT type, occurred_at::text AS occurred_at, payload FROM event WHERE booking_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
    [bookingId]
  );
  return r.rows;
}
