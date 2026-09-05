import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types";

// 12-escalations-notifications.md config, in every environment (same "config, not demo fixture"
// treatment as seed/sla-policies.ts). `escalation_ladder`'s step durations have no source in the
// PDF or `emergent-business-rules.md` (p22 §16 names the four tiers, not numeric timings) —
// seeded as UNCONFIRMED placeholders, same convention journey-standard.ts/sla-policies.ts already
// use for East Crest/PT-task durations with no real source. L0 fires at DUE_SOON (no elapsed-hours
// threshold — matches rule 1's "L0 = pre-breach alert to owner" literally); L1's 48h approximates
// "at OVERDUE" (a single ladder's fixed hours can't reference every sla_policy's own
// due_soon_lead_days individually — documented simplification, see escalations/core.ts's header).
const STANDARD_LADDER_STEPS = [
  { tier: "L0", after_hours: 0, to: "OWNER", notify_channel: "IN_APP" },
  { tier: "L1", after_hours: 48, to: "BACKUP_OWNER", notify_channel: "IN_APP" }, // UNCONFIRMED
  { tier: "L2", after_hours: 120, to: "DEPT_HEAD", notify_channel: "EMAIL" }, // UNCONFIRMED
  { tier: "L3", after_hours: 240, to: "PROJECT_HEAD", notify_channel: "EMAIL" }, // UNCONFIRMED
  { tier: "L4", after_hours: 360, to: "MANAGEMENT", notify_channel: "EMAIL" }, // UNCONFIRMED
];

// 12's own Data table lists exactly these 13 [E §11.1] rules. `wired = false` for all 13 — verified,
// not assumed: escalations/core.ts's header documents that NO createAction call site outside
// journey/instances.ts sets a real deadline (`due_at` or `sla_clock_id`), so none of these 13 named
// sources has an action to escalate through yet, independent of which underlying spec is or isn't
// built. Seeded anyway with real severity/category/decision_options so Policy Studio has real
// config the day one of these gets a due date wired in (flip `wired` then, not before).
// decision_options are this session's own rule-2 placeholders (no source names them) — a real
// default and a "clears the block" alternative each, UNCONFIRMED same as the ladder above.
const RULES: {
  rule_key: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; department: string;
  category: "CUSTOMER" | "CASH" | "HANDOVER" | "REPUTATION" | "MARGIN"; source_module: string;
  threshold_value: number; threshold_unit: "DAYS" | "HOURS" | "INR"; wired: boolean;
  decision_options: { label: string; clears_block: boolean; leakage_inr: number | null }[];
}[] = [
  { rule_key: "commitment_3d", severity: "MEDIUM", department: "CRM", category: "CUSTOMER", source_module: "commitments", threshold_value: 3, threshold_unit: "DAYS", wired: false, decision_options: [] },
  { rule_key: "commitment_7d", severity: "HIGH", department: "CRM", category: "CUSTOMER", source_module: "commitments", threshold_value: 7, threshold_unit: "DAYS", wired: false, decision_options: [] },
  {
    rule_key: "payment_15d", severity: "MEDIUM", department: "ACCOUNTS", category: "CASH", source_module: "collections", threshold_value: 15, threshold_unit: "DAYS", wired: false,
    decision_options: [{ label: "Send reminder", clears_block: false, leakage_inr: null }, { label: "Waive late fee", clears_block: true, leakage_inr: 0 }],
  },
  {
    rule_key: "payment_30d", severity: "HIGH", department: "ACCOUNTS", category: "CASH", source_module: "collections", threshold_value: 30, threshold_unit: "DAYS", wired: false,
    decision_options: [{ label: "Escalate to legal", clears_block: false, leakage_inr: null }, { label: "Reschedule with reason", clears_block: true, leakage_inr: null }],
  },
  { rule_key: "tds_5d", severity: "MEDIUM", department: "ACCOUNTS", category: "CASH", source_module: "tds", threshold_value: 5, threshold_unit: "DAYS", wired: false, decision_options: [] },
  { rule_key: "loan_sanction_15d", severity: "MEDIUM", department: "BANKING", category: "CASH", source_module: "loans", threshold_value: 15, threshold_unit: "DAYS", wired: false, decision_options: [] },
  {
    rule_key: "sanction_validity_7d", severity: "HIGH", department: "BANKING", category: "CASH", source_module: "loans", threshold_value: 7, threshold_unit: "DAYS", wired: false,
    decision_options: [{ label: "Chase lender for renewal", clears_block: true, leakage_inr: null }, { label: "Move to customer-due demands", clears_block: false, leakage_inr: null }],
  },
  { rule_key: "legal_review_5d", severity: "MEDIUM", department: "LEGAL", category: "HANDOVER", source_module: "legal", threshold_value: 5, threshold_unit: "DAYS", wired: false, decision_options: [] },
  { rule_key: "registration_slot_3d", severity: "MEDIUM", department: "REGISTRATION", category: "HANDOVER", source_module: "registrations", threshold_value: 3, threshold_unit: "DAYS", wired: false, decision_options: [] },
  { rule_key: "critical_snag_2d", severity: "HIGH", department: "SITE", category: "HANDOVER", source_module: "snagging", threshold_value: 2, threshold_unit: "DAYS", wired: false, decision_options: [] },
  { rule_key: "handover_15d", severity: "MEDIUM", department: "FM", category: "HANDOVER", source_module: "handovers", threshold_value: 15, threshold_unit: "DAYS", wired: false, decision_options: [] },
  { rule_key: "handover_7d", severity: "HIGH", department: "FM", category: "HANDOVER", source_module: "handovers", threshold_value: 7, threshold_unit: "DAYS", wired: false, decision_options: [] },
  { rule_key: "customer_query_48h", severity: "LOW", department: "CRM", category: "REPUTATION", source_module: "customer_query", threshold_value: 48, threshold_unit: "HOURS", wired: false, decision_options: [] },
];

// PDF materiality (₹ exposure, customer count) — spec's own Data table marks these placeholders
// [ASK_CLIENT]. Seeded conservatively low so the mechanism is exercisable in the demo, not left
// empty like 19's WAIVER bands (waivers block on an empty matrix by design; materiality doesn't
// block anything — it only narrows what MANAGEMENT sees, so an empty table already fails open to
// "show everything", the safe default) — real values need Amarsh's numbers.
const MATERIALITY = [
  { scope: "MANAGEMENT_ALERT", metric: "INR_EXPOSURE", value: 500000 }, // UNCONFIRMED, ASK_CLIENT
  { scope: "MANAGEMENT_ALERT", metric: "CUSTOMER_COUNT", value: 1 }, // UNCONFIRMED, ASK_CLIENT
];

export async function seedEscalationConfig(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM escalation_ladder`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  const ladderId = randomUUID();
  await db.query(
    `INSERT INTO escalation_ladder (id, code, steps, effective_from) VALUES ($1,'STANDARD',$2::jsonb,'2020-01-01')`,
    [ladderId, JSON.stringify(STANDARD_LADDER_STEPS)]
  );
  // Attach the standard ladder to every real per-task sla_policy row (T1-T13/PT1-PT6, seeded by
  // seed/sla-policies.ts) so rule 1's SLA-clock-driven path has something real to escalate through.
  await db.query(`UPDATE sla_policy SET escalation_ladder_id = $1 WHERE escalation_ladder_id IS NULL`, [ladderId]);

  for (const r of RULES) {
    await db.query(
      `INSERT INTO escalation_rule (rule_key, severity, department, category, source_module, threshold_value, threshold_unit, decision_options, wired, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'2020-01-01')`,
      [r.rule_key, r.severity, r.department, r.category, r.source_module, r.threshold_value, r.threshold_unit, JSON.stringify(r.decision_options), r.wired]
    );
  }

  for (const m of MATERIALITY) {
    await db.query(`INSERT INTO materiality_threshold (id, scope, metric, value) VALUES ($1,$2,$3,$4)`, [randomUUID(), m.scope, m.metric, m.value]);
  }
}
