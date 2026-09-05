import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types";

// 16-handover-gates.md's Config section: "handover_gate_config (p26 §21), checklist template,
// thresholds." Seeds the 8 standard (project_id NULL) gate rows so handover/store.ts's
// loadGateConfig always resolves real rows on a fresh DB — values match handover/store.ts's own
// FALLBACK_CONFIG exactly (see that file's citation of p17 §9), kept here as the persisted,
// Studio-editable copy rather than a second source of truth to drift from.
const GATES: { gate: string; classification: "HARD" | "SOFT"; overridable: boolean; override_roles: string[]; requires_approval: boolean; requires_evidence: boolean; params: Record<string, unknown> }[] = [
  { gate: "FINANCIAL", classification: "HARD", overridable: true, override_roles: ["MANAGEMENT", "SUPER_ADMIN"], requires_approval: true, requires_evidence: false, params: {} },
  { gate: "LEGAL", classification: "HARD", overridable: true, override_roles: ["LEGAL", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
  { gate: "REGISTRATION", classification: "HARD", overridable: true, override_roles: ["REGISTRATION", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: { allow_possession_before_registration: false } },
  { gate: "PHYSICAL", classification: "HARD", overridable: false, override_roles: [], requires_approval: false, requires_evidence: false, params: {} },
  { gate: "QUALITY", classification: "HARD", overridable: true, override_roles: ["QA", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: true, params: { critical_open_max: 0, major_open_max: 0 } },
  { gate: "COMMITMENTS", classification: "HARD", overridable: true, override_roles: ["CRM", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
  { gate: "CUSTOMER", classification: "SOFT", overridable: true, override_roles: ["CRM", "QA", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
  { gate: "FM_COMMUNITY", classification: "SOFT", overridable: true, override_roles: ["FM", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
];

export async function seedHandoverGateConfig(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM handover_gate_config WHERE project_id IS NULL`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  for (const g of GATES) {
    await db.query(
      `INSERT INTO handover_gate_config (id, gate, classification, overridable, override_roles, requires_approval, requires_evidence, project_id, params, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8::jsonb,1)`,
      [randomUUID(), g.gate, g.classification, g.overridable, g.override_roles, g.requires_approval, g.requires_evidence, JSON.stringify(g.params)]
    );
  }

  // 10-universal-action.md action_type row for rescheduleAppointment's createAction call
  // (handover/core.ts rule 4). UNCONFIRMED priority — same placeholder class as every other
  // seeded action_type default.
  await db.query(
    `INSERT INTO action_type (code, family, label, default_owner_role, default_priority)
     VALUES ('handover_appointment_reschedule', 'FOLLOW_UP', 'Reschedule handover appointment', 'CRM', 'MEDIUM')
     ON CONFLICT (code) DO NOTHING`
  );
}
