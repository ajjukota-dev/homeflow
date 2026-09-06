import type { DbClient } from "../db/types";

// 29-communications.md config, in every environment (same "config, not demo fixture" treatment
// as seed/sla-policies.ts / seed/escalation-rules.ts). Two real config pieces:
//  1. The `customer_query_response` sla_policy — rule 6's 48h unresolved-query escalation needs a
//     real sla_clock-backed action to escalate through (escalations/core.ts's own documented
//     mechanism), so this is the one sla_policy row communications/core.ts's follow-up action
//     creation points at. Sets `escalation_ladder_id` directly (not via seedEscalationConfig's own
//     UPDATE, which only ran over rows that existed when IT first seeded — same fix already
//     applied once for snag_sla_policy, see seed/qa-templates.ts's own comment).
//  2. `frequency_guardrail` defaults per purpose (rule 4) — UNCONFIRMED numbers, no PDF source for
//     exact caps; seeded so the guardrail mechanism is exercisable, same convention as the
//     escalation ladder's own UNCONFIRMED step timings.

const GUARDRAILS: { purpose: string; max_per_customer_per_window: number; window_days: number }[] = [
  { purpose: "PAYMENT_REMINDER", max_per_customer_per_window: 3, window_days: 7 }, // UNCONFIRMED
  { purpose: "DELAY_NOTICE", max_per_customer_per_window: 2, window_days: 30 }, // UNCONFIRMED
  { purpose: "MILESTONE", max_per_customer_per_window: 5, window_days: 30 }, // UNCONFIRMED
  { purpose: "CHECK_IN", max_per_customer_per_window: 1, window_days: 7 }, // UNCONFIRMED
  { purpose: "GENERAL", max_per_customer_per_window: 10, window_days: 30 }, // UNCONFIRMED
];

export async function seedCommunicationsConfig(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM sla_policy WHERE code = 'customer_query_response'`);
  if (Number(existing.rows[0]?.count ?? 0) === 0) {
    await db.query(
      `INSERT INTO sla_policy (id, code, applies_to, target_ref, duration_value, duration_unit, due_soon_lead_days, effective_from, escalation_ladder_id)
       VALUES ('customer_query_response', 'customer_query_response', 'CUSTOMER_QUERY', 'FOLLOW_UP', 48, 'HOURS', 12, '2020-01-01',
         (SELECT id FROM escalation_ladder WHERE code = 'STANDARD' LIMIT 1))`
    );
  }

  const guardrails = await db.query<{ count: string }>(`SELECT count(*)::text FROM frequency_guardrail`);
  if (Number(guardrails.rows[0]?.count ?? 0) > 0) return; // idempotent
  for (const g of GUARDRAILS) {
    await db.query(
      `INSERT INTO frequency_guardrail (purpose, max_per_customer_per_window, window_days) VALUES ($1,$2,$3)`,
      [g.purpose, g.max_per_customer_per_window, g.window_days]
    );
  }
}
