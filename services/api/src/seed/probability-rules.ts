import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types";

// 20-cash-forecast.md's own Data-row seed, marked DEFAULT_UNCONFIRMED there — real numbers need
// Amarsh, same class as 12/13's ladder hours and materiality thresholds. Every environment needs
// these before the forecast module has any probability to report — config, not demo data, same
// treatment as seed/sla-policies.ts/seed/escalation-rules.ts. `condition` is display-only today
// (see forecast/probability.ts's header) — stored so Policy Studio has real rows to edit once a
// rule-expression engine exists to interpret this column, same class of not-yet-wired config
// column as sla_policy.at_risk_rule/change_gate_rule.condition_expr.
const RULES: { source_type: string; condition: Record<string, unknown>; probability: number }[] = [
  { source_type: "CONTRACTUAL_DUE", condition: { ever_late: false }, probability: 0.95 },
  { source_type: "CONTRACTUAL_DUE", condition: { ever_late: true }, probability: 0.85 },
  { source_type: "OVERDUE_RECOVERY", condition: { age_band: "0-15d" }, probability: 0.6 },
  { source_type: "OVERDUE_RECOVERY", condition: { age_band: "16-45d" }, probability: 0.4 },
  { source_type: "OVERDUE_RECOVERY", condition: { age_band: "46-90d" }, probability: 0.25 },
  { source_type: "OVERDUE_RECOVERY", condition: { age_band: ">90d" }, probability: 0.1 },
  { source_type: "PROMISE_TO_PAY", condition: { base: true }, probability: 0.7 }, // x historical honour rate — see forecast/probability.ts
  { source_type: "LOAN_DISBURSEMENT", condition: { stage_band: "sanctioned_or_later" }, probability: 0.9 },
  { source_type: "LOAN_DISBURSEMENT", condition: { stage_band: "applied" }, probability: 0.5 },
  { source_type: "APPROVED_RESCHEDULE", condition: {}, probability: 0.8 },
];

export async function seedProbabilityRules(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM probability_rule`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  for (const r of RULES) {
    await db.query(
      `INSERT INTO probability_rule (id, source_type, condition, probability) VALUES ($1,$2,$3::jsonb,$4)`,
      [randomUUID(), r.source_type, JSON.stringify(r.condition), r.probability]
    );
  }
}
