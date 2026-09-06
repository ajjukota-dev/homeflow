import type { DbClient } from "../db/types";

// 30-post-handover.md config, in every environment (same "config, not demo fixture" treatment
// as seed/communications.ts). Two real config pieces:
//  1. `dlp_policy` — one global default (project_id NULL) covering every product_type, since no
//     project-specific DLP window numbers exist yet (same "don't invent East-Crest-specific
//     values" call as 05/07's own seeds). Category months are the spec's own named examples
//     (structural 60, waterproofing 24, electrical/plumbing 12, fittings 6) — UNCONFIRMED, no PDF
//     source for exact durations.
//  2. Three `sla_policy` rows (CRITICAL/MAJOR/MINOR) so a warranty case's response clock is a real
//     `sla_clock` via 06's own mechanism, not a second parallel timer — UNCONFIRMED day counts,
//     same class as 12's ladder-hour placeholders.

const DEFAULT_WINDOWS = [
  { category: "STRUCTURAL", months: 60 },
  { category: "WATERPROOFING", months: 24 },
  { category: "ELECTRICAL", months: 12 },
  { category: "PLUMBING", months: 12 },
  { category: "FITTINGS", months: 6 },
];

const SEVERITY_SLA: { code: string; severity: string; duration_value: number }[] = [
  { code: "warranty_critical", severity: "CRITICAL", duration_value: 2 }, // UNCONFIRMED
  { code: "warranty_major", severity: "MAJOR", duration_value: 5 }, // UNCONFIRMED
  { code: "warranty_minor", severity: "MINOR", duration_value: 10 }, // UNCONFIRMED
];

export async function seedPostHandoverConfig(db: DbClient): Promise<void> {
  const policy = await db.query<{ count: string }>(`SELECT count(*)::text FROM dlp_policy WHERE project_id IS NULL AND product_type = 'DEFAULT'`);
  if (Number(policy.rows[0]?.count ?? 0) === 0) {
    await db.query(
      `INSERT INTO dlp_policy (id, project_id, product_type, windows, response_sla_by_severity, unconfirmed)
       VALUES ('dlp_policy_default', NULL, 'DEFAULT', $1::jsonb, $2::jsonb, true)`,
      [JSON.stringify(DEFAULT_WINDOWS), JSON.stringify({ CRITICAL: 2, MAJOR: 5, MINOR: 10 })]
    );
  }

  for (const s of SEVERITY_SLA) {
    const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM sla_policy WHERE code = $1`, [s.code]);
    if (Number(existing.rows[0]?.count ?? 0) > 0) continue;
    await db.query(
      `INSERT INTO sla_policy (id, code, applies_to, target_ref, duration_value, duration_unit, due_soon_lead_days, effective_from)
       VALUES ($1,$1,'WARRANTY_SEVERITY',$2,$3,'CALENDAR_DAYS',1,'2020-01-01')`,
      [s.code, s.severity, s.duration_value]
    );
  }
}
