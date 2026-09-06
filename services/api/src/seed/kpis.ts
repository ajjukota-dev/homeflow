import { query } from "../db";

// 27-management-control-tower.md rule 4 — every KPI p24-25 §19 names, one row per code. `target`
// values are UNCONFIRMED placeholders (p24-25 gives no numeric targets, same "don't invent
// business numbers" call as East Crest's durations/12's ladder hours) — seeded so the KPIs view
// has something to compare against, flagged via `materiality_ref: 'UNCONFIRMED'` on every row.

interface KpiSeed {
  code: string;
  domain: string;
  name: string;
  formula_ref: string;
  unit: "PERCENT" | "DAYS" | "INR" | "COUNT" | "SCORE";
  direction: "HIGHER_BETTER" | "LOWER_BETTER";
  target: number | null;
}

const KPIS: KpiSeed[] = [
  { code: "sh_ftr_pct", domain: "SALES_HANDOVER", name: "Sales-handover first-time-right %", formula_ref: "sh_ftr_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 90 },
  { code: "sh_handover_cycle_days", domain: "SALES_HANDOVER", name: "Handover cycle (days)", formula_ref: "sh_handover_cycle_days", unit: "DAYS", direction: "LOWER_BETTER", target: 2 },
  { code: "j_on_time_pct", domain: "JOURNEY", name: "Journey stages on-time %", formula_ref: "j_on_time_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 85 },
  { code: "j_stage_slippage_days", domain: "JOURNEY", name: "Average stage slippage (days)", formula_ref: "j_stage_slippage_days", unit: "DAYS", direction: "LOWER_BETTER", target: 0 },
  { code: "j_sla_breach_pct", domain: "JOURNEY", name: "SLA breach %", formula_ref: "j_sla_breach_pct", unit: "PERCENT", direction: "LOWER_BETTER", target: 10 },
  { code: "c_efficiency_pct", domain: "COLLECTIONS", name: "Collection efficiency %", formula_ref: "c_efficiency_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 95 },
  { code: "c_overdue_inr", domain: "COLLECTIONS", name: "Overdue ₹", formula_ref: "c_overdue_inr", unit: "INR", direction: "LOWER_BETTER", target: null },
  { code: "c_true_risk_inr", domain: "COLLECTIONS", name: "True-risk ₹", formula_ref: "c_true_risk_inr", unit: "INR", direction: "LOWER_BETTER", target: null },
  { code: "c_forecast_accuracy_pct", domain: "COLLECTIONS", name: "Forecast accuracy %", formula_ref: "c_forecast_accuracy_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 90 },
  { code: "c_ptp_honour_pct", domain: "COLLECTIONS", name: "Promise-to-pay honour %", formula_ref: "c_ptp_honour_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 80 },
  { code: "lr_cycle_days", domain: "LEGAL_REGISTRATION", name: "Registration cycle (days)", formula_ref: "lr_cycle_days", unit: "DAYS", direction: "LOWER_BETTER", target: 30 },
  { code: "lr_deviation_rate_pct", domain: "LEGAL_REGISTRATION", name: "Document deviation rate %", formula_ref: "lr_deviation_rate_pct", unit: "PERCENT", direction: "LOWER_BETTER", target: 15 },
  { code: "lr_registration_slippage_days", domain: "LEGAL_REGISTRATION", name: "Registration slippage (days)", formula_ref: "lr_registration_slippage_days", unit: "DAYS", direction: "LOWER_BETTER", target: 0 },
  { code: "q_snag_closure_pct", domain: "QUALITY_HANDOVER", name: "Snag closure %", formula_ref: "q_snag_closure_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 95 },
  { code: "q_repeat_defects_pct", domain: "QUALITY_HANDOVER", name: "Repeat defects %", formula_ref: "q_repeat_defects_pct", unit: "PERCENT", direction: "LOWER_BETTER", target: 5 },
  { code: "q_critical_snag_age_days", domain: "QUALITY_HANDOVER", name: "Critical snag age (days)", formula_ref: "q_critical_snag_age_days", unit: "DAYS", direction: "LOWER_BETTER", target: 2 },
  { code: "h_on_time_pct", domain: "QUALITY_HANDOVER", name: "Handover on-time %", formula_ref: "h_on_time_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 85 },
  { code: "h_override_count", domain: "QUALITY_HANDOVER", name: "Handover overrides", formula_ref: "h_override_count", unit: "COUNT", direction: "LOWER_BETTER", target: 0 },
  { code: "cu_cycle_time_days", domain: "CUSTOMISATION", name: "Customisation cycle time (days)", formula_ref: "cu_cycle_time_days", unit: "DAYS", direction: "LOWER_BETTER", target: 21 },
  { code: "cu_approval_time_days", domain: "CUSTOMISATION", name: "Approval time (days)", formula_ref: "cu_approval_time_days", unit: "DAYS", direction: "LOWER_BETTER", target: 3 },
  { code: "cu_contribution_inr", domain: "CUSTOMISATION", name: "Customisation contribution ₹", formula_ref: "cu_contribution_inr", unit: "INR", direction: "HIGHER_BETTER", target: null },
  { code: "cu_release_before_payment_count", domain: "CUSTOMISATION", name: "Release-before-payment exceptions", formula_ref: "cu_release_before_payment_count", unit: "COUNT", direction: "LOWER_BETTER", target: 0 },
  { code: "ph_warranty_tat_days", domain: "POST_HANDOVER", name: "Warranty turnaround (days)", formula_ref: "ph_warranty_tat_days", unit: "DAYS", direction: "LOWER_BETTER", target: 7 },
  { code: "ph_dlp_closure_pct", domain: "POST_HANDOVER", name: "DLP closure %", formula_ref: "ph_dlp_closure_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 90 },
  { code: "ex_checkin_score", domain: "EXPERIENCE", name: "Check-in score (1-5)", formula_ref: "ex_checkin_score", unit: "SCORE", direction: "HIGHER_BETTER", target: 4 },
  { code: "ex_escalations_per_100", domain: "EXPERIENCE", name: "Escalations per 100 customers", formula_ref: "ex_escalations_per_100", unit: "COUNT", direction: "LOWER_BETTER", target: 5 },
  { code: "ex_commitment_fulfilment_pct", domain: "EXPERIENCE", name: "Commitment fulfilment %", formula_ref: "ex_commitment_fulfilment_pct", unit: "PERCENT", direction: "HIGHER_BETTER", target: 90 },
  { code: "pr_leakage_inr", domain: "PROFITABILITY", name: "Leakage ₹", formula_ref: "pr_leakage_inr", unit: "INR", direction: "LOWER_BETTER", target: null },
  { code: "pr_variation_contribution_inr", domain: "PROFITABILITY", name: "Variation contribution ₹", formula_ref: "pr_variation_contribution_inr", unit: "INR", direction: "HIGHER_BETTER", target: null },
  { code: "pr_delay_cost_inr", domain: "PROFITABILITY", name: "Delay cost ₹", formula_ref: "pr_delay_cost_inr", unit: "INR", direction: "LOWER_BETTER", target: null },
];

export async function seedKpis(): Promise<void> {
  const existing = await query<{ count: string }>(`SELECT count(*)::text FROM kpi_definition`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;
  for (const k of KPIS) {
    await query(
      `INSERT INTO kpi_definition (code, domain, name, formula_ref, unit, direction, target, materiality_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,'UNCONFIRMED')`,
      [k.code, k.domain, k.name, k.formula_ref, k.unit, k.direction, k.target]
    );
  }
  // Rule 1/2/6 config — UNCONFIRMED placeholders, same class as 12's ladder hours / 20's cash
  // targets: p21 §14/§15 name the mechanism, not the numbers. Registered in Studio's generic
  // table envelope so Amarsh/Pranava can set real values without a code change.
  const CONFIG: [string, unknown][] = [
    ["intervention_ranking_weights", { inr: 1, customers: 100000, days: 50000 }],
    ["dismiss_cooldown_days", 14],
    ["delay_cost_per_day_inr", 5000],
  ];
  for (const [key, value] of CONFIG) {
    await query(`INSERT INTO management_config (key, value, unconfirmed) VALUES ($1, $2::jsonb, true) ON CONFLICT (key) DO NOTHING`, [key, JSON.stringify(value)]);
  }
}
