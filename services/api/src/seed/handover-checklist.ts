import type { DbClient } from "../db/types";

// 17-sales-crm-handover.md rule 2 + Data table seed [E §4.1 + §8.1]. Standard rows
// (project_id null) apply to every project until Amarsh adds a project-specific override via
// Policy Studio (deferred UI — see studio/registry.ts). residency 'ANY' rows apply regardless of
// the primary applicant's residency; RESIDENT/NRI/OCI rows are additive on top of the ANY set.
// Weight is 1 per item (spec gives no explicit weighting) — UNCONFIRMED, tune once Amarsh has an
// opinion; Σweight is just item count until then, which is an honest even split.
const CONFIRMATIONS = [
  "applicant_details_confirmed",
  "contact_verified",
  "nri_status_confirmed",
  "communication_pref_confirmed",
  "unit_confirmed",
  "facing_confirmed",
  "parking_confirmed",
];

const FIELDS = ["final_price_inr", "discount_inr", "payment_plan_ref", "booking_amount_inr", "brokerage"];

// Documents_section is scored against the existing booking.docs jsonb (already captured at
// booking creation, bookings.ts's MANDATORY_DOCS) rather than a `files` table — 22 (document
// factory/checklist) isn't built, and the spec's own fallback ("documents section stores
// uploaded files via files with category") names a table that doesn't exist either. booking.docs
// is real, live data already produced by the one flow that reaches this checklist.
const DOCS_ALL = ["Booking Form", "Cost Sheet", "PAN", "Identity Proof", "Address Proof", "Photograph"];

export async function seedHandoverChecklist(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM handover_checklist_rule`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent, mirrors seed/action-types.ts

  let seq = 0;
  const insert = async (item_code: string, kind: string, residency: string, required = true, weight = 1) => {
    seq += 1;
    await db.query(
      `INSERT INTO handover_checklist_rule (id, project_id, product_type, residency, item_code, kind, required, weight)
       VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6)`,
      [`hcr_${seq}`, residency, item_code, kind, required, weight]
    );
  };

  for (const c of CONFIRMATIONS) await insert(c, "CONFIRMATION", "ANY");
  for (const f of FIELDS) await insert(f, "FIELD", "ANY");
  for (const d of DOCS_ALL) await insert(d, "DOCUMENT", "ANY");
  await insert("Passport", "DOCUMENT", "NRI");
  await insert("OCI card", "DOCUMENT", "OCI");
  // "POA if applicable" (rule per Data table) — no applicability flag exists anywhere in the
  // model to say whether a given booking has a POA applicant, so this can't be scored as
  // required without guessing. Seeded as optional AND weight 0 — visible in the checklist
  // detail if satisfied, but never blocks submit and never drags the percentage down for the
  // common case (no POA applicant) — flagged, not silently dropped.
  await insert("POA", "DOCUMENT", "ANY", false, 0);
  // Rule 3's commercial-approval item — required, but "satisfied" is computed dynamically in
  // sales-handover/checklist.ts (no threshold configured or approval closed), not from packet
  // presence like every other item here.
  await insert("commercial_approval", "APPROVAL", "ANY");

  const REASONS: { code: string; label: string; category: string }[] = [
    { code: "MISSING_DOCUMENTS", label: "Missing or incomplete documents", category: "DOCUMENTS" },
    { code: "DOCUMENT_MISMATCH", label: "Document details don't match applicant", category: "DOCUMENTS" },
    { code: "COMMERCIAL_UNAPPROVED", label: "Discount/brokerage not commercially approved", category: "COMMERCIAL" },
    { code: "PRICING_ERROR", label: "Pricing or payment plan error", category: "COMMERCIAL" },
    { code: "CUSTOMER_DATA_INCOMPLETE", label: "Customer details incomplete or unverified", category: "CUSTOMER_DATA" },
    { code: "RESIDENCY_UNCONFIRMED", label: "Residency status not confirmed", category: "CUSTOMER_DATA" },
    { code: "UNIT_MISMATCH", label: "Unit/facing details don't match booking", category: "UNIT_DATA" },
    { code: "COMMITMENT_UNCLEAR", label: "Commitment made to customer is unclear or undocumented", category: "COMMITMENTS" },
    { code: "OTHER", label: "Other", category: "OTHER" },
  ];
  for (const r of REASONS) {
    await db.query(`INSERT INTO return_reason (code, label, category) VALUES ($1, $2, $3)`, [r.code, r.label, r.category]);
  }
}
