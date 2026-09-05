import type { DbClient } from "../db/types";

// Per-task SLA policies (06-timeline-sla-engine.md `sla_policy`), config in every environment
// (like seed/journey-standard.ts). Durations for T1-T13 are the SLA-days column from
// `docs/reference/emergent-business-rules.md` §2.2 — the doc's own note: "the only per-task
// duration Pranava has (implicitly) approved — seed it as SlaPolicy rows." PT1-PT6 (no
// Emergent precedent) get a small UNCONFIRMED placeholder, same convention as the stage
// durations in journey-standard.ts.

const POLICIES: { task_code: string; duration_value: number; unconfirmed?: boolean }[] = [
  { task_code: "PT1", duration_value: 3, unconfirmed: true },
  { task_code: "T1", duration_value: 2 },
  { task_code: "T2", duration_value: 3 },
  { task_code: "T3", duration_value: 7 },
  { task_code: "T4", duration_value: 10 },
  { task_code: "T5", duration_value: 5 },
  { task_code: "T6", duration_value: 3 },
  { task_code: "T7", duration_value: 3 },
  { task_code: "T8", duration_value: 5 },
  { task_code: "T9", duration_value: 4 },
  { task_code: "T10", duration_value: 3 },
  { task_code: "T11", duration_value: 30 },
  { task_code: "PT2", duration_value: 15, unconfirmed: true },
  { task_code: "T12", duration_value: 7 },
  { task_code: "PT3", duration_value: 3, unconfirmed: true },
  { task_code: "T13", duration_value: 3 },
  { task_code: "PT4", duration_value: 1, unconfirmed: true },
  { task_code: "PT5", duration_value: 1, unconfirmed: true },
  { task_code: "PT6", duration_value: 1, unconfirmed: true },
];

export async function seedSlaPolicies(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM sla_policy WHERE code LIKE 'task_%'`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  for (const p of POLICIES) {
    await db.query(
      `INSERT INTO sla_policy (id, code, applies_to, target_ref, duration_value, duration_unit, due_soon_lead_days, effective_from)
       VALUES ($1,$1,'TASK_CODE',$2,$3,'WORKING_DAYS',2,'2020-01-01')`,
      [`task_${p.task_code.toLowerCase()}`, p.task_code, p.duration_value]
    );
  }
}
