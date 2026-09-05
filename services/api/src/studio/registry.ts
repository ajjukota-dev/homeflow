import { STAFF_ROLES, POLICY_STUDIO_ROLES } from "../authz/requireRole";

// Tab registry (25-policy-studio.md §Tabs, p26-27 §21) — same "flag, don't fake" pattern as
// events/registry.ts's built:true/false: every bullet from the spec's own Tabs line is present
// here (the acceptance test's "checklist test ... asserts the tab registry contains each"),
// most with built:false because their owning spec isn't merged yet. `built` here means "this tab
// has a real edit path today" (its own dedicated routes, OR wired into this file's generic
// /studio/:table CRUD — see studio/core.ts's TABLE_REGISTRY) — not just "the owning spec merged."
// edit_roles follows rule 3: SUPER_ADMIN is implicit on every tab (checked separately by the
// route, not listed per row); MANAGEMENT is added for tabs that read as "business policy"
// (matrices/thresholds/weights/approval config); the five departments rule 3 names explicitly
// (Legal, Accounts, Projects->SITE, CRM, QA) are added only to the tabs it names. Every other
// tab defaults to SUPER_ADMIN-only edit — a deliberately conservative default rather than
// guessing a department rule 3 doesn't state.

export interface TabDef {
  key: string; // "<owner_spec>.<slug>"
  label: string;
  owner_spec: number;
  built: boolean;
  edit_roles: string[]; // in addition to SUPER_ADMIN, which every route checks regardless
}

const MGMT = POLICY_STUDIO_ROLES; // ["MANAGEMENT", "SUPER_ADMIN"]

export const TAB_REGISTRY: TabDef[] = [
  // 01 — identity & access (merged)
  { key: "01.permission_matrix", label: "Permission matrix", owner_spec: 1, built: true, edit_roles: MGMT },
  { key: "01.field_sensitivity", label: "Field sensitivity", owner_spec: 1, built: false, edit_roles: MGMT },
  { key: "01.teams_assignments", label: "Teams & assignments", owner_spec: 1, built: true, edit_roles: MGMT },

  // 04 — canonical model (merged)
  { key: "04.project_master", label: "Project master", owner_spec: 4, built: true, edit_roles: ["SITE"] },
  { key: "04.hierarchy", label: "Hierarchy", owner_spec: 4, built: true, edit_roles: ["SITE"] },
  { key: "04.unit_types", label: "Unit types", owner_spec: 4, built: false, edit_roles: ["SITE"] },
  { key: "04.applicant_limits", label: "Applicant limits", owner_spec: 4, built: false, edit_roles: MGMT },

  // 05 — journey templates (merged; own bespoke draft/publish, not the generic envelope)
  { key: "05.journey_template_studio", label: "Journey Template Studio", owner_spec: 5, built: true, edit_roles: MGMT },

  // 06 — timeline & SLA engine (merged)
  { key: "06.sla_policies", label: "SLA policies", owner_spec: 6, built: false, edit_roles: MGMT }, // deferred: sla_policy has its own effective_from/version columns, needs bespoke draft/publish like 05's, not this segment's generic envelope — see studio/core.ts header
  { key: "06.calendars", label: "Calendars", owner_spec: 6, built: true, edit_roles: MGMT },
  { key: "06.delay_reasons", label: "Delay reasons", owner_spec: 6, built: true, edit_roles: MGMT },

  // 07 — unit progress control (not built)
  { key: "07.progress_components", label: "Progress components", owner_spec: 7, built: false, edit_roles: ["SITE"] },
  { key: "07.freshness_thresholds", label: "Freshness thresholds", owner_spec: 7, built: false, edit_roles: ["SITE"] },

  // 08 — changeability engine (not built)
  { key: "08.change_categories", label: "Change categories", owner_spec: 8, built: false, edit_roles: ["SITE"] },
  { key: "08.change_gate_rule_studio", label: "Change Gate Rule Studio", owner_spec: 8, built: false, edit_roles: ["SITE"] },
  { key: "08.gate_expiry_sources", label: "Gate-expiry sources", owner_spec: 8, built: false, edit_roles: ["SITE"] },

  // 09 — spec revisions (not built)
  { key: "09.specification_baselines", label: "Specification baselines", owner_spec: 9, built: false, edit_roles: ["SITE"] },
  { key: "09.variation_catalogue", label: "Variation catalogue", owner_spec: 9, built: false, edit_roles: ["SITE"] },

  // 10 — universal action (merged)
  { key: "10.action_types", label: "Action types", owner_spec: 10, built: true, edit_roles: MGMT },

  // 11 — my day / ranking (not built)
  { key: "11.ranking_weights", label: "Ranking weights", owner_spec: 11, built: false, edit_roles: MGMT },

  // 12 — escalations & notifications (not built)
  { key: "12.escalation_rules", label: "Escalation rules", owner_spec: 12, built: false, edit_roles: MGMT },
  { key: "12.ladders", label: "Ladders", owner_spec: 12, built: false, edit_roles: MGMT },
  { key: "12.materiality_thresholds", label: "Materiality thresholds", owner_spec: 12, built: false, edit_roles: MGMT },
  { key: "12.notification_defaults", label: "Notification defaults", owner_spec: 12, built: false, edit_roles: MGMT },

  // 13 — promise ledger (not built)
  { key: "13.commitment_approvers_leads", label: "Commitment approvers/leads", owner_spec: 13, built: false, edit_roles: MGMT },

  // 14 — readiness scores (not built)
  { key: "14.score_weights_thresholds", label: "Score weights & thresholds", owner_spec: 14, built: false, edit_roles: MGMT },

  // 15 — QA evidence & snags (not built)
  { key: "15.qa_checklist_templates", label: "QA checklist templates", owner_spec: 15, built: false, edit_roles: ["QA"] },
  { key: "15.snag_sla", label: "Snag SLA", owner_spec: 15, built: false, edit_roles: ["QA"] },
  { key: "15.contractors", label: "Contractors", owner_spec: 15, built: false, edit_roles: ["QA"] },

  // 16 — handover gates (not built)
  { key: "16.handover_gate_configuration", label: "Handover gate configuration", owner_spec: 16, built: false, edit_roles: MGMT },
  { key: "16.handover_checklist", label: "Handover checklist", owner_spec: 16, built: false, edit_roles: MGMT },

  // 17 — sales -> CRM handover (backend built; Studio CRUD UI deferred like every other spec's)
  { key: "17.sales_handover_checklist_rules", label: "Sales handover checklist rules", owner_spec: 17, built: false, edit_roles: ["CRM"] },
  { key: "17.return_reasons", label: "Return reasons", owner_spec: 17, built: false, edit_roles: ["CRM"] },

  // 18 — change requests (not built)
  { key: "18.customisation_policy", label: "Customisation policy", owner_spec: 18, built: false, edit_roles: MGMT },

  // 19 — collections & true risk (not built)
  { key: "19.payment_plans", label: "Payment plans", owner_spec: 19, built: false, edit_roles: ["ACCOUNTS"] },
  { key: "19.overdue_reasons", label: "Overdue reasons", owner_spec: 19, built: false, edit_roles: ["ACCOUNTS"] },
  { key: "19.clearance_checklist_threshold", label: "Clearance checklist/threshold", owner_spec: 19, built: false, edit_roles: ["ACCOUNTS"] },

  // 20 — cash forecast (not built)
  { key: "20.probability_rules", label: "Probability rules", owner_spec: 20, built: false, edit_roles: MGMT },
  { key: "20.cash_targets", label: "Cash targets", owner_spec: 20, built: false, edit_roles: MGMT },
  { key: "20.period_calendar", label: "Period calendar", owner_spec: 20, built: false, edit_roles: MGMT },

  // 22 — document factory (not built)
  { key: "22.templates", label: "Templates", owner_spec: 22, built: false, edit_roles: ["LEGAL"] },
  { key: "22.clauses", label: "Clauses", owner_spec: 22, built: false, edit_roles: ["LEGAL"] },
  { key: "22.selection_rules", label: "Selection rules", owner_spec: 22, built: false, edit_roles: ["LEGAL"] },
  { key: "22.merge_fields", label: "Merge fields", owner_spec: 22, built: false, edit_roles: ["LEGAL"] },
  { key: "22.document_checklist_rules", label: "Document checklist rules", owner_spec: 22, built: false, edit_roles: ["LEGAL"] },

  // 23 — registration (not built)
  { key: "23.registration_checklists", label: "Registration checklists", owner_spec: 23, built: false, edit_roles: ["REGISTRATION"] },
  { key: "23.sro_offices", label: "SRO offices", owner_spec: 23, built: false, edit_roles: ["REGISTRATION"] },

  // 24 — holds (not built)
  { key: "24.hold_policy", label: "Hold policy", owner_spec: 24, built: false, edit_roles: MGMT },
  { key: "24.filter_thresholds", label: "Filter thresholds", owner_spec: 24, built: false, edit_roles: MGMT },

  // 25 — policy studio itself
  { key: "25.approval_authority_matrix", label: "Approval authority matrix", owner_spec: 25, built: true, edit_roles: MGMT },
  { key: "25.config_export_import", label: "Config export/import", owner_spec: 25, built: true, edit_roles: MGMT }, // export only — see routes-studio.ts

  // 26 — customer portal (not built)
  { key: "26.customer_visibility_wording", label: "Customer visibility & wording", owner_spec: 26, built: false, edit_roles: MGMT },

  // 29 — communications (not built)
  { key: "29.communication_templates", label: "Communication templates", owner_spec: 29, built: false, edit_roles: MGMT },
  { key: "29.frequency_guardrails", label: "Frequency guardrails", owner_spec: 29, built: false, edit_roles: MGMT },

  // 30 — post-handover (not built)
  { key: "30.dlp_warranty_policy", label: "DLP/warranty policy", owner_spec: 30, built: false, edit_roles: ["FM"] },
  { key: "30.checkin_schedule", label: "Check-in schedule", owner_spec: 30, built: false, edit_roles: ["FM"] },
];

/** Rule 3: role-filtered listing for GET /studio/tabs — read access is any staff role
 *  (STAFF_ROLES already includes SUPER_ADMIN/MANAGEMENT), edit eligibility is per-tab. */
export function tabsForRoles(roles: string[]): (TabDef & { can_edit: boolean })[] {
  const isStaff = roles.some((r) => STAFF_ROLES.includes(r));
  if (!isStaff) return [];
  return TAB_REGISTRY.map((t) => ({ ...t, can_edit: roles.includes("SUPER_ADMIN") || t.edit_roles.some((r) => roles.includes(r)) }));
}
