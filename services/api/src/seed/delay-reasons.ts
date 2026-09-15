import type { DbClient } from "../db/types";

// Catalog only (06 delay_reason) — labels/categories, not day counts or East Crest SOP.

const REASONS: { code: string; label: string; category: string; counts_against_sla: boolean }[] = [
  { code: "CUSTOMER_CHANGE", label: "Customer-requested change", category: "CUSTOMER", counts_against_sla: false },
  { code: "INTERNAL_RESEQUENCE", label: "Internal resequence", category: "INTERNAL", counts_against_sla: true },
  { code: "VENDOR_DEPENDENCY", label: "Vendor dependency", category: "VENDOR", counts_against_sla: true },
  { code: "STATUTORY_HOLD", label: "Statutory hold", category: "STATUTORY", counts_against_sla: false },
  { code: "FINANCE_CLEARANCE", label: "Finance clearance", category: "FINANCE", counts_against_sla: true },
  { code: "FORCE_MAJEURE", label: "Force majeure", category: "FORCE_MAJEURE", counts_against_sla: false },
];

export async function seedDelayReasons(db: DbClient): Promise<void> {
  for (const r of REASONS) {
    await db.query(
      `INSERT INTO delay_reason (code, label, category, counts_against_sla)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO NOTHING`,
      [r.code, r.label, r.category, r.counts_against_sla]
    );
  }
}
