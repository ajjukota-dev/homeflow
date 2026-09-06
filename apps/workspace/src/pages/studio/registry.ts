// Column shape for the tables the generic /studio/:table envelope covers — MUST mirror
// services/api/src/studio/core.ts::TABLE_REGISTRY exactly (primaryKey, columns, json/array
// columns). listStudioTable returns bare rows with no column metadata, so the editor needs
// this to know which fields are jsonb (JSON textarea) vs text[] (comma list) vs plain text.
// Every other tab in studio/registry.ts's TAB_REGISTRY has its own bespoke edit route/UI (or
// none built yet) and isn't listed here.

export interface GenericTableDef {
  primaryKey: string;
  columns: string[];
  jsonColumns?: string[];
  arrayColumns?: string[];
}

export const GENERIC_TABLES: Record<string, GenericTableDef> = {
  project_calendar: { primaryKey: "id", columns: ["name", "working_days", "holidays", "timezone", "product_types"], jsonColumns: ["working_days", "holidays"], arrayColumns: ["product_types"] },
  delay_reason: { primaryKey: "code", columns: ["label", "category", "counts_against_sla", "product_types"], arrayColumns: ["product_types"] },
  action_type: { primaryKey: "code", columns: ["family", "label", "default_owner_role", "default_priority", "default_evidence_requirement", "customer_visible_default", "product_types"], arrayColumns: ["product_types"] },
  probability_rule: { primaryKey: "id", columns: ["source_type", "condition", "probability", "effective_from", "effective_to", "version", "product_types"], jsonColumns: ["condition"], arrayColumns: ["product_types"] },
  cash_target: { primaryKey: "id", columns: ["project_id", "period", "target_inr", "set_by", "product_types"], arrayColumns: ["product_types"] },
  period_calendar: { primaryKey: "project_id", columns: ["fiscal_year_start_month", "week_start_day", "product_types"], arrayColumns: ["product_types"] },
  customer_visibility_rule: { primaryKey: "id", columns: ["entity", "field", "project_id", "visible", "customer_wording"] },
  frequency_guardrail: { primaryKey: "purpose", columns: ["max_per_customer_per_window", "window_days", "quiet_hours_start", "quiet_hours_end"] },
  dlp_policy: { primaryKey: "id", columns: ["project_id", "product_type", "windows", "response_sla_by_severity", "unconfirmed"], jsonColumns: ["windows", "response_sla_by_severity"] },
  risk_rule: { primaryKey: "id", columns: ["service", "signal", "condition", "weight", "driver_text", "effective_from", "effective_to", "version"], jsonColumns: ["condition"] },
  // 2026-09-06 batch — mirrors services/api/src/studio/core.ts's TABLE_REGISTRY additions exactly.
  component_definition: { primaryKey: "code", columns: ["label", "sort_order", "parent_code", "product_types", "readiness_weight", "evidence_required", "stale_after_days", "effective_from", "effective_to"], arrayColumns: ["product_types"] },
  change_category: { primaryKey: "code", columns: ["customer_label", "customer_visible", "sort_order", "product_types", "trade", "default_lead_days", "weight"], arrayColumns: ["product_types"] },
  escalation_rule: { primaryKey: "rule_key", columns: ["severity", "department", "category", "source_module", "threshold_value", "threshold_unit", "decision_options", "wired", "effective_from", "effective_to"], jsonColumns: ["decision_options"] },
  escalation_ladder: { primaryKey: "id", columns: ["code", "steps", "effective_from", "effective_to"], jsonColumns: ["steps"] },
  materiality_threshold: { primaryKey: "id", columns: ["scope", "metric", "value"] },
  score_weight: { primaryKey: "id", columns: ["score_type", "component", "weight", "effective_from", "effective_to", "version"] },
  qa_checklist_template: { primaryKey: "id", columns: ["component_code", "product_types", "items", "min_photos", "version", "effective_from", "effective_to"], jsonColumns: ["items"], arrayColumns: ["product_types"] },
  snag_sla_policy: { primaryKey: "severity", columns: ["sla_policy_id", "unconfirmed"] },
  contractor: { primaryKey: "id", columns: ["name", "trade", "contact", "active"] },
  handover_checklist_rule: { primaryKey: "id", columns: ["project_id", "product_type", "residency", "item_code", "kind", "required", "weight", "effective_from", "effective_to"] },
  return_reason: { primaryKey: "code", columns: ["label", "category"] },
  overdue_reason: { primaryKey: "code", columns: ["label", "next_action", "category", "default_action_type"] },
  sales_policy: { primaryKey: "id", columns: ["project_id", "highly_customisable_min", "closing_soon_days", "match_stale_hours", "match_weights", "state_values", "must_have_hard_closed_cap", "filter_categories"], jsonColumns: ["match_weights", "state_values", "filter_categories"] },
};

/** Tab key -> table name, for the tabs whose `key` doesn't already equal the table name
 *  (studio/registry.ts's tab keys are "<spec>.<slug>", the table names are snake_case nouns). */
export const TAB_TO_TABLE: Record<string, string> = {
  "06.calendars": "project_calendar",
  "06.delay_reasons": "delay_reason",
  "10.action_types": "action_type",
  "20.probability_rules": "probability_rule",
  "20.cash_targets": "cash_target",
  "20.period_calendar": "period_calendar",
  "26.customer_visibility_wording": "customer_visibility_rule",
  "29.frequency_guardrails": "frequency_guardrail",
  "30.dlp_warranty_policy": "dlp_policy",
  "31.risk_rules": "risk_rule",
  "07.progress_components": "component_definition",
  "07.freshness_thresholds": "component_definition",
  "08.change_categories": "change_category",
  "12.escalation_rules": "escalation_rule",
  "12.ladders": "escalation_ladder",
  "12.materiality_thresholds": "materiality_threshold",
  "14.score_weights_thresholds": "score_weight",
  "15.qa_checklist_templates": "qa_checklist_template",
  "15.snag_sla": "snag_sla_policy",
  "15.contractors": "contractor",
  "17.sales_handover_checklist_rules": "handover_checklist_rule",
  "17.return_reasons": "return_reason",
  "19.overdue_reasons": "overdue_reason",
  "24.filter_thresholds": "sales_policy",
};
