// 28-360-views.md rule 2 — Customer 360's Overview tab, plus a manifest for the rest. Health
// score now calls 31's own real `intelligence/customer-health.ts` (rule 2's own text named 31 as
// the eventual owner: "until 31: derived from check-ins + escalations + overdue") — 31 has since
// landed. Kept this file's own simpler `{score, drivers: {label, delta}}` shape (rather than
// switching to 31's richer `Score` contract with unsigned `contribution`) to avoid a breaking
// change to `Customer360View`/`views.test.ts` for a view that only ever needed a headline number
// and signed deltas — a thin adapter, not a re-derivation: every driver 31 computes is a penalty,
// so `delta = -contribution` always.

import { db } from "../db";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { commitmentsForBooking, type CommitmentView } from "../commitments/core";
import { listChangeRequests } from "../change-requests/capture";
import type { CrRow } from "../change-requests/store";
import { computeCustomerHealth as computeRealCustomerHealth } from "../intelligence/customer-health";
import { tab, type TabManifestEntry } from "./tabs";

export interface CustomerHealth { score: number; drivers: { label: string; delta: number }[] }

async function computeCustomerHealth(customerId: string): Promise<CustomerHealth> {
  const real = await computeRealCustomerHealth(customerId);
  return {
    score: real.value,
    drivers: real.drivers.map((d) => ({ label: d.fact, delta: -d.contribution })),
  };
}

export interface Customer360View {
  customer_id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  kyc_status: string;
  residency: string;
  merged_into_customer_id: string | null;
  bookings: { id: string; booking_number: string; status: string; unit_number: string }[];
  applicants: { display_name: string; role: string; booking_number: string }[];
  merged_from: { id: string; display_name: string }[]; // customers merged into this one (04 rule 5)
  commitments: CommitmentView[];
  change_requests: { id: string; booking_id: string; status: string; title: string }[];
  health: CustomerHealth;
  tabs: TabManifestEntry[];
}

export async function getCustomer360(customerId: string, ctx: Ctx): Promise<Customer360View> {
  // rule 5: this is a customer_overview READ, not a generic staff screen — the permission_matrix
  // locks several role columns (SITE, FM) to N here, unlike requireRole(STAFF_ROLES) which would
  // let them through. Advisor caught this exact bypass at landing (same class as 26's
  // customer_documents READ->WRITE widening, this time routing around the matrix instead).
  await authorize(ctx, "customer_overview", "READ");
  const c = await db.query<{
    display_name: string; primary_phone: string | null; primary_email: string | null;
    kyc_status: string; residency: string; merged_into_customer_id: string | null;
  }>(`SELECT display_name, primary_phone, primary_email, kyc_status, residency, merged_into_customer_id FROM customer WHERE id = $1`, [customerId]);
  if (!c.rows[0]) throw new AppError("not_found", "not_found");

  const bookings = await db.query<{ id: string; booking_number: string; status: string; unit_number: string }>(
    `SELECT b.id, b.booking_number, b.status, u.unit_number
       FROM booking b JOIN booking_applicant a ON a.booking_id = b.id JOIN unit u ON u.id = b.unit_id
      WHERE a.customer_id = $1`,
    [customerId]
  );
  const applicants = await db.query<{ display_name: string; role: string; booking_number: string }>(
    `SELECT a.display_name, a.role, b.booking_number FROM booking_applicant a JOIN booking b ON b.id = a.booking_id WHERE a.customer_id = $1`,
    [customerId]
  );
  const mergedFrom = await db.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM customer WHERE merged_into_customer_id = $1`,
    [customerId]
  );

  // Commitments (13) and Requests (18) span all of the customer's bookings — both reuse the
  // existing booking-scoped functions per booking rather than duplicating a customer_id query
  // (neither `commitmentsForBooking` nor `listChangeRequests` supports a multi-booking filter).
  const commitmentLists = await Promise.all(bookings.rows.map((b) => commitmentsForBooking(b.id, ctx)));
  const commitments = commitmentLists.flat();
  const crLists = await Promise.all(bookings.rows.map((b) => listChangeRequests({ booking_id: b.id }, ctx)));
  const change_requests: CrRow[] = crLists.flat();

  const health = await computeCustomerHealth(customerId);

  return {
    customer_id: customerId,
    display_name: c.rows[0].display_name,
    primary_phone: c.rows[0].primary_phone,
    primary_email: c.rows[0].primary_email,
    kyc_status: c.rows[0].kyc_status,
    residency: c.rows[0].residency,
    merged_into_customer_id: c.rows[0].merged_into_customer_id,
    bookings: bookings.rows,
    applicants: applicants.rows,
    merged_from: mergedFrom.rows,
    commitments,
    change_requests: change_requests.map((cr) => ({ id: cr.id, booking_id: cr.booking_id, status: cr.status, title: cr.title })),
    health,
    tabs: [
      tab("communications", "Communications", `/api/customers/${customerId}/communications`),
      tab("requests", "Requests", `/api/customers/${customerId}/360`), // returned inline above — 18 has no multi-booking listing endpoint; 30's post-handover requests not built
      tab("documents", "Documents (KYC)", `/api/customers/${customerId}/documents`),
      tab("activity", "Activity", `/api/customers/${customerId}/activity`),
    ],
  };
}

export async function getCustomerDocuments(customerId: string, ctx: Ctx) {
  await authorize(ctx, "customer_documents", "READ");
  const r = await db.query(
    `SELECT id, category, status, required, applicable, file_keys FROM customer_document WHERE customer_id = $1 ORDER BY category`,
    [customerId]
  );
  return r.rows;
}

export async function getCustomerActivity(customerId: string, ctx: Ctx) {
  await authorize(ctx, "customer_activity", "READ");
  const r = await db.query(
    `SELECT type, occurred_at::text AS occurred_at, payload FROM event WHERE customer_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
    [customerId]
  );
  return r.rows;
}
