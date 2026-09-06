import { randomUUID } from "node:crypto";
import { query } from "../db";
import type { Level } from "../authz/levels";

// Seeds `role`, `permission_matrix`, `field_sensitivity` — data, not code
// (00-conventions.md "Config over code"), editable later in Policy Studio.
// Role × module values are emergent-business-rules.md §1.3 verbatim, mapped
// R→READ S→READ_STATUS_ONLY L→READ_LIMITED W→WRITE N→NONE. The SITE column
// also seeds QA (Emergent folds both into one `site_engineer` row — PDF calls
// QA an independent authority, but the 33-module list has no module that can
// express "verifies" vs "executes"; splitting them here would invent policy
// spec 15/16 would have to undo — flagged as a finding instead).
const LETTER: Record<string, Level> = { R: "READ", S: "READ_STATUS_ONLY", L: "READ_LIMITED", W: "WRITE", N: "NONE" };
const COLS = ["MANAGEMENT", "SALES", "CRM", "ACCOUNTS", "BANKING", "LEGAL", "REGISTRATION", "SITE", "FM"] as const;

const MATRIX: [string, string][] = [
  ["dashboard", "R R R R R R R R R"],
  ["customer_overview", "R R W R R R R L L"],
  ["customer_journey", "R R W R R R R N N"],
  ["customer_tasks", "R N W R R R R W N"],
  ["customer_documents", "R N R R R W R N N"],
  ["customer_financials", "R N R W R S S N N"],
  ["customer_loan", "R N R R W R R N N"],
  ["customer_legal", "R N R N N W R N N"],
  ["customer_registration", "R N R N N W W N N"],
  ["customer_unit_readiness", "R N R N N N N W W"],
  ["customer_snags", "R N R N N N N W W"],
  ["customer_commitments", "R R W R N R R N N"],
  ["customer_communications", "R W W N N N N N N"],
  ["customer_handover", "R N R N N N N W W"],
  ["customer_activity", "R R R R R R R R R"],
  ["customer_audit", "R N R R N R R N N"],
  ["sales_handover", "R W W N N N N N N"],
  ["documents", "R N R R R W R N N"],
  ["collections", "R N S W R S N N N"],
  ["loans", "R N R R W R R N N"],
  ["legal", "R N R N N W R N N"],
  ["registrations", "R N R N N W W N N"],
  ["unit_readiness", "R N R N N N N W W"],
  ["snagging", "R N R N N N N W W"],
  ["handovers", "R N R N N N N W W"],
  ["commitments", "R R W R N R R N N"],
  ["communications", "R W W N N N N N N"],
  ["escalations", "R R W R R R R N N"],
  ["approvals", "W R W W R W W W N"],
  ["notifications", "R R R R R R R R R"],
  ["comments", "W W W W W W W W W"],
  ["reports", "R N R R N R R N N"],
  ["administration", "N N N N N N N N N"],
];
const MODULES = MATRIX.map(([m]) => m);

// No Emergent data for CUSTOMISATION; least-privilege default (read own-status
// modules + collaboration) until Policy Studio / Pranava confirm its footprint.
const CUSTOMISATION_MODULES: Record<string, Level> = {
  dashboard: "READ",
  customer_overview: "READ",
  customer_journey: "READ",
  notifications: "READ",
  comments: "WRITE",
};

// Emergent disables the customer role entirely; the portal needs it, so this
// grants read access to the modules a customer's own booking exposes (26-customer-portal owns
// the UI). Every customer-initiated write in 26 (upload a document, raise a request, confirm
// registration availability/a handover appointment, respond to a check-in) is gated by an
// own-booking row check in its owning module instead of this matrix, so none of these need a
// WRITE row here — including customer_documents, whose upload path (portal/core.ts::
// uploadCustomerDocument) checks ownership itself before delegating to 22's uploadDocument.
const CUSTOMER_MODULES: Record<string, Level> = {
  customer_journey: "READ",
  customer_documents: "READ",
  customer_financials: "READ",
  customer_loan: "READ",
  customer_commitments: "READ",
  customer_unit_readiness: "READ",
  customer_snags: "READ",
  customer_handover: "READ",
  notifications: "READ",
  comments: "WRITE",
};

export const ROLES: { code: string; name: string; description: string }[] = [
  { code: "SALES", name: "Sales", description: "Books units, reads gates" },
  { code: "CRM", name: "CRM", description: "Owns the customer record end to end" },
  { code: "ACCOUNTS", name: "Accounts", description: "Demands, receipts, true-risk collections" },
  { code: "BANKING", name: "Banking", description: "Loan cases and disbursement" },
  { code: "LEGAL", name: "Legal", description: "Document generation and execution" },
  { code: "REGISTRATION", name: "Registration", description: "SRO scheduling and registration" },
  { code: "SITE", name: "Site", description: "Owns unit physical progress" },
  { code: "QA", name: "QA", description: "Evidence-based readiness verification" },
  { code: "CUSTOMISATION", name: "Customisation", description: "Spec/change coordination" },
  { code: "FM", name: "FM", description: "Facility management post-handover" },
  { code: "MANAGEMENT", name: "Management", description: "Reads everything, approves" },
  { code: "SUPER_ADMIN", name: "Super Admin", description: "Full administration" },
  { code: "CUSTOMER", name: "Customer", description: "Portal access to their own booking" },
];

interface MatrixRow {
  role_code: string;
  module: string;
  level: Level;
}

const EFFECTIVE_FROM = "2020-01-01"; // seed epoch; Policy Studio adds future-dated versions

function expandMatrix(): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const [module, line] of MATRIX) {
    const letters = line.split(" ");
    COLS.forEach((col, i) => {
      const level = LETTER[letters[i]];
      if (col === "SITE") {
        rows.push({ role_code: "SITE", module, level });
        rows.push({ role_code: "QA", module, level });
      } else {
        rows.push({ role_code: col, module, level });
      }
    });
  }
  for (const module of MODULES) rows.push({ role_code: "SUPER_ADMIN", module, level: "ADMIN" });
  for (const module of MODULES) {
    rows.push({ role_code: "CUSTOMISATION", module, level: CUSTOMISATION_MODULES[module] ?? "NONE" });
    rows.push({ role_code: "CUSTOMER", module, level: CUSTOMER_MODULES[module] ?? "NONE" });
  }
  // Rule 2: MANAGEMENT can also create/invite staff and manage assignments.
  const mgmt = rows.find((r) => r.role_code === "MANAGEMENT" && r.module === "administration");
  if (mgmt) mgmt.level = "WRITE";
  const sa = rows.find((r) => r.role_code === "SUPER_ADMIN" && r.module === "administration");
  if (sa) sa.level = "ADMIN";
  return rows;
}

// emergent-business-rules.md §1.5 — financial fields (+ un-suffixed twins, masked in mask.ts).
const FINANCIAL_FIELDS = [
  "agreement_value_inr", "booking_amount_inr", "base_price_inr", "discount", "brokerage",
  "demand_amount_inr", "amount_inr", "outstanding_inr", "balance_inr", "overdue_inr", "tax_inr", "gst",
  "planned_amount_inr", "total_due_inr", "total_received_inr", "total_outstanding_inr", "total_overdue_inr",
  "future_receivable_inr", "received_verified_inr", "received_pending_inr", "sanctioned_amount_inr",
  "requested_amount_inr", "own_contribution_inr", "disbursement_amount_inr", "disbursed_amount_inr",
  "tds_amount_inr", "gross_amount_inr",
];
const FINANCIAL_MODULES = ["customer_financials", "collections"];

const PII_FIELDS = [
  "phone", "alt_phone", "email", "pan", "aadhaar", "passport", "oci", "oci_number", "address",
  "address_line", "city", "state", "pincode", "co_applicants", "nri_status", "communication_preference",
  "kyc_documents",
];

export async function seedIdentity(): Promise<void> {
  const existing = await query<{ count: string }>(`SELECT count(*)::text FROM role`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent — initDb() may run once per process already

  for (const r of ROLES) {
    await query(`INSERT INTO role (code, name, description) VALUES ($1,$2,$3)`, [r.code, r.name, r.description]);
  }
  for (const row of expandMatrix()) {
    await query(
      `INSERT INTO permission_matrix (id, role_code, module, level, effective_from, version) VALUES ($1,$2,$3,$4,$5,1)`,
      [randomUUID(), row.role_code, row.module, row.level, EFFECTIVE_FROM]
    );
  }
  for (const module of FINANCIAL_MODULES) {
    for (const field of FINANCIAL_FIELDS) {
      await query(`INSERT INTO field_sensitivity (module, field, class, min_level) VALUES ($1,$2,'FINANCIAL','READ_LIMITED')`, [module, field]);
    }
  }
  for (const field of PII_FIELDS) {
    await query(`INSERT INTO field_sensitivity (module, field, class, min_level) VALUES ('customer_overview',$1,'PII','READ')`, [field]);
  }
}
