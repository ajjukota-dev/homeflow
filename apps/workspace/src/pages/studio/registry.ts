// Column shape for the 10 tables the generic /studio/:table envelope covers — MUST mirror
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
};
