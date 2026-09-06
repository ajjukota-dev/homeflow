import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types";

// 31-intelligence.md rules 1-3 — seeds `risk_rule` with the spec's own named signals so Policy
// Studio has real rows to show. Same "schema completeness, not read by the scorer" gap 0029's own
// migration already documented for `score_weight`/`probability_rule`: `intelligence/*.ts` use
// named in-code constants for their actual weights (a live weight-table read is real future work,
// flagged not faked — wiring a read against a table nobody's UI can populate yet would be the
// fake, not the honest gap). Weights below mirror the in-code constants so Studio isn't lying
// about what the engine currently does, but editing a row here has no effect until that live-read
// wiring lands.

const RULES: { service: string; signal: string; weight: number; driver_text: string }[] = [
  { service: "CUSTOMER_HEALTH", signal: "checkin_satisfaction", weight: 8, driver_text: "Check-in satisfaction score" },
  { service: "CUSTOMER_HEALTH", signal: "open_escalation", weight: 10, driver_text: "Open escalation(s)" },
  { service: "CUSTOMER_HEALTH", signal: "overdue_amount", weight: 15, driver_text: "Overdue payment" },
  { service: "CUSTOMER_HEALTH", signal: "breached_commitment", weight: 12, driver_text: "Breached or at-risk commitment" },
  { service: "CUSTOMER_HEALTH", signal: "unresolved_communication", weight: 6, driver_text: "Unresolved inbound communication" },
  { service: "CUSTOMER_HEALTH", signal: "pending_action_age", weight: 5, driver_text: "Aging pending customer action" },
  { service: "FINANCIAL_HEALTH", signal: "true_risk_share", weight: 20, driver_text: "True-risk share of receivables" },
  { service: "FINANCIAL_HEALTH", signal: "forecast_variance", weight: 15, driver_text: "Forecast variance" },
  { service: "FINANCIAL_HEALTH", signal: "loan_gap", weight: 15, driver_text: "Loan sanction/requirement gap" },
  { service: "FINANCIAL_HEALTH", signal: "waiver_leakage", weight: 10, driver_text: "Waiver leakage" },
  { service: "FINANCIAL_HEALTH", signal: "clearance_status", weight: 10, driver_text: "Clearance/NOC status" },
  { service: "JOURNEY_RISK", signal: "sla_state", weight: 0.4, driver_text: "SLA clock state" },
  { service: "JOURNEY_RISK", signal: "slippage_vs_baseline", weight: 0.3, driver_text: "Slippage vs journey baseline" },
  { service: "JOURNEY_RISK", signal: "dependency_blocked", weight: 0.2, driver_text: "Blocked dependency chain" },
  { service: "JOURNEY_RISK", signal: "gate_freshness", weight: 0.1, driver_text: "Stale gate evaluation" },
  { service: "COLLECTION_RISK", signal: "probability_inverse", weight: 0.5, driver_text: "Inverse of 20's collection probability" },
  { service: "COLLECTION_RISK", signal: "reason_category", weight: 0.3, driver_text: "Delay reason category" },
  { service: "COLLECTION_RISK", signal: "customer_health", weight: 0.2, driver_text: "Customer Health score" },
  { service: "COMMITMENT_RISK", signal: "confidence_inverse", weight: 1, driver_text: "Inverse of 13's confidence score" },
];

export async function seedIntelligenceConfig(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM risk_rule`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;
  for (const r of RULES) {
    await db.query(
      `INSERT INTO risk_rule (id, service, signal, condition, weight, driver_text) VALUES ($1,$2,$3,'{}'::jsonb,$4,$5)`,
      ["risk_rule_" + randomUUID().slice(0, 8), r.service, r.signal, r.weight, r.driver_text]
    );
  }
}
