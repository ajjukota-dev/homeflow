import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types";

// 22 rule 8 config: the KYC checklist by residency. UNCONFIRMED against the spec's own [E §8.1]
// counts (Resident 9 / NRI 10 / OCI 11) — that source list isn't available here, so this seeds a
// smaller, real starter set rather than inventing filler rows to hit a count. AGREEMENT/
// TDS_CHALLAN/REGISTRATION_DOCUMENTS/HANDOVER_DOCUMENTS/POA are lifecycle-triggered elsewhere
// (legal-docs.ts, 23, 30, per-applicant) — not seeded here.
const RESIDENT = ["PAN", "IDENTITY_PROOF", "ADDRESS_PROOF", "PHOTOGRAPH", "BOOKING_FORM", "COST_SHEET"] as const;
const NRI = [...RESIDENT, "PASSPORT"] as const;
const OCI = [...NRI, "OCI"] as const;

export async function seedDocumentChecklistRules(db: DbClient): Promise<void> {
  const rows: { residency: string; category: string }[] = [
    ...RESIDENT.map((category) => ({ residency: "RESIDENT", category })),
    ...NRI.map((category) => ({ residency: "NRI", category })),
    ...OCI.map((category) => ({ residency: "OCI", category })),
  ];
  for (const r of rows) {
    await db.query(
      `INSERT INTO document_checklist_rule (id, residency, category, required) VALUES ($1,$2,$3,true)
       ON CONFLICT (COALESCE(project_id, ''), residency, COALESCE(product_type, ''), category) DO NOTHING`,
      [randomUUID(), r.residency, r.category]
    );
  }
}
