import type { DbClient } from "../db/types";

// Pranava Standard Journey Template — config, not demo data (00-conventions.md "Config over
// code"), so this seeds in every environment alongside role/permission_matrix, unlike
// seed.ts/seed-lifecycle.ts's East Crest fixtures. Inserted PUBLISHED directly (published_by
// NULL — "system", not a person) rather than going through templates.ts's ctx-gated
// createTemplate/publishVersion, because this runs before any "user" row exists in a fresh
// prod boot (seedUsers() is demo-gated) and publishVersion's published_by has a FK to "user".
//
// Stage list is 05-journey-templates.md's Seed section (p45 §34.2, 12 names — the spec's own
// parenthetical says "11"; the list itself has 12, so the list wins per CLAUDE.md "spec is
// authoritative" applied to the more specific artifact — flagged in TODO.md). Task shapes,
// SLA days (as stage-level planned_duration_days — journey_task_template has no per-task
// duration column) and dependency edges are docs/reference/emergent-business-rules.md §2.2/2.4
// (T1-T13), which 05 explicitly says to reuse ("use its SLA days and task shapes, not its
// stage list"). PDF tasks with no Emergent precedent (PT1 personalisation discovery, PT2
// customisation, PT3 handover appointment, PT4-6 post-handover check-ins) carry an
// UNCONFIRMED marker on their stage's planned_duration_days, per 05's seed note.
//
// Not seeded here (deliberate scope cut, logged in TODO.md): VILLA/PLOT product-overlay
// templates (05 "VILLA: no tower deps/access card; PLOT: no interior stages"). T11's
// checklist below carries the APARTMENT superset; a product-specific PROJECT-scope override
// is a Journey Template Studio config action, not something this seed should hardcode.

interface StageSeed {
  code: string;
  name: string;
  customer_name: string | null;
  stream: string;
  planned_duration_days: number;
  owner_department: string;
  customer_visible?: boolean;
  is_mandatory?: boolean;
  condition_expr?: string;
}

interface TaskSeed {
  stage_code: string;
  code: string;
  title: string;
  customer_title?: string;
  owner_role: string;
  task_type: "MANDATORY" | "CONDITIONAL";
  execution_type: "SIMPLE" | "VERIFICATION" | "EVIDENCE" | "APPROVAL" | "CHECKLIST" | "EXTERNAL";
  verifier_role?: string;
  approver_role?: string;
  external_party?: "CUSTOMER" | "SRO" | "BANK" | "VENDOR";
  required_document_category?: string;
  checklist_items?: string[];
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  condition_expr?: string;
}

const STAGES: StageSeed[] = [
  // planned_duration_days UNCONFIRMED (no Emergent precedent) — see file header.
  { code: "PRESALES", name: "Pre-Sales & Personalisation Discovery", customer_name: "Getting to know your home", stream: "COMMERCIAL", planned_duration_days: 5, owner_department: "SALES" },
  { code: "BOOKING", name: "Booking", customer_name: "Booking", stream: "COMMERCIAL", planned_duration_days: 2, owner_department: "SALES" },
  { code: "SALES_CRM_HANDOVER", name: "Sales→CRM Handover", customer_name: null, stream: "COMMERCIAL", planned_duration_days: 3, owner_department: "CRM", customer_visible: false },
  { code: "DOCS_KYC", name: "Documentation & KYC", customer_name: "Documents & KYC", stream: "COMMERCIAL", planned_duration_days: 17, owner_department: "CRM" },
  { code: "AGREEMENT", name: "Agreement", customer_name: "Agreement for Sale", stream: "LEGAL", planned_duration_days: 8, owner_department: "LEGAL" },
  { code: "PAYMENTS_FUNDING", name: "Payments & Funding", customer_name: "Payments", stream: "FINANCE", planned_duration_days: 8, owner_department: "ACCOUNTS" },
  { code: "REGISTRATION", name: "Registration", customer_name: "Registration", stream: "LEGAL", planned_duration_days: 7, owner_department: "REGISTRATION" },
  { code: "CONSTRUCTION", name: "Construction Progress", customer_name: "Construction progress", stream: "CONSTRUCTION", planned_duration_days: 30, owner_department: "SITE" },
  // UNCONFIRMED — conditional stage (rule per 05 acceptance t5).
  { code: "CUSTOMISATION", name: "Customisation", customer_name: "Customisation requests", stream: "CONSTRUCTION", planned_duration_days: 15, owner_department: "CUSTOMISATION", is_mandatory: false, condition_expr: "booking.has_change_requests == true" },
  { code: "READINESS_QA", name: "Readiness, QA & Snagging", customer_name: "Quality checks", stream: "HANDOVER", planned_duration_days: 7, owner_department: "QA" },
  // 5 days of the 8 are UNCONFIRMED (handover appointment scheduling has no Emergent precedent).
  { code: "HANDOVER", name: "Handover", customer_name: "Handover", stream: "HANDOVER", planned_duration_days: 8, owner_department: "FM" },
  // UNCONFIRMED — 90 spans the 7/30/90-day check-in cadence, not a task-effort estimate.
  { code: "POST_HANDOVER", name: "Post-Handover Care", customer_name: "Post-handover care", stream: "POST_HANDOVER", planned_duration_days: 90, owner_department: "FM" },
];

const TASKS: TaskSeed[] = [
  { stage_code: "PRESALES", code: "PT1", title: "Personalisation discovery call", customer_title: "Discovery call", owner_role: "SALES", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "MEDIUM" },
  { stage_code: "BOOKING", code: "T1", title: "Submit booking pack to CRM", owner_role: "SALES", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "HIGH" },
  { stage_code: "SALES_CRM_HANDOVER", code: "T2", title: "CRM accept handover", owner_role: "SALES", task_type: "MANDATORY", execution_type: "VERIFICATION", verifier_role: "CRM", priority: "HIGH" },
  { stage_code: "DOCS_KYC", code: "T3", title: "Collect PAN + Address proof", owner_role: "CRM", task_type: "MANDATORY", execution_type: "EVIDENCE", verifier_role: "CRM", required_document_category: "KYC", priority: "HIGH" },
  { stage_code: "DOCS_KYC", code: "T4", title: "NRI declaration", owner_role: "CRM", task_type: "CONDITIONAL", execution_type: "EVIDENCE", priority: "MEDIUM", condition_expr: "customer.residency in [NRI,OCI]" },
  { stage_code: "AGREEMENT", code: "T5", title: "Draft agreement", owner_role: "LEGAL", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "HIGH" },
  { stage_code: "AGREEMENT", code: "T6", title: "Legal approval", owner_role: "LEGAL", task_type: "MANDATORY", execution_type: "APPROVAL", approver_role: "LEGAL", priority: "HIGH" },
  { stage_code: "PAYMENTS_FUNDING", code: "T7", title: "Booking amount receipt", owner_role: "ACCOUNTS", task_type: "MANDATORY", execution_type: "EVIDENCE", required_document_category: "Booking", priority: "HIGH" },
  { stage_code: "PAYMENTS_FUNDING", code: "T8", title: "TDS challan verify", owner_role: "ACCOUNTS", task_type: "MANDATORY", execution_type: "EVIDENCE", required_document_category: "TDS", priority: "HIGH" },
  { stage_code: "REGISTRATION", code: "T9", title: "Confirm customer availability", owner_role: "REGISTRATION", task_type: "MANDATORY", execution_type: "SIMPLE", external_party: "CUSTOMER", priority: "MEDIUM" },
  { stage_code: "REGISTRATION", code: "T10", title: "Book SRO slot", owner_role: "REGISTRATION", task_type: "MANDATORY", execution_type: "EVIDENCE", required_document_category: "Registration", external_party: "SRO", priority: "HIGH" },
  // Checklist carries the Apartment superset (base 5 + tower_deps/access_card) — see file header.
  { stage_code: "CONSTRUCTION", code: "T11", title: "Site declares Ready-for-QA", owner_role: "SITE", task_type: "MANDATORY", execution_type: "CHECKLIST", checklist_items: ["civil", "electrical", "plumbing", "painting", "cleaning", "tower_deps", "access_card"], priority: "HIGH" },
  { stage_code: "CUSTOMISATION", code: "PT2", title: "Process customisation change request", owner_role: "CUSTOMISATION", task_type: "CONDITIONAL", execution_type: "EVIDENCE", priority: "MEDIUM", condition_expr: "booking.has_change_requests == true" },
  { stage_code: "READINESS_QA", code: "T12", title: "QA inspection sign-off", owner_role: "QA", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "HIGH" },
  { stage_code: "HANDOVER", code: "PT3", title: "Schedule handover appointment", owner_role: "FM", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "MEDIUM" },
  // Emergent's owner_role/verifier_role="HANDOVER" isn't a real role in this system (13 seeded
  // roles, seed/permissions.ts) — mapped to FM, the closest real department (post-handover ops).
  { stage_code: "HANDOVER", code: "T13", title: "Customer acknowledgement", owner_role: "FM", task_type: "MANDATORY", execution_type: "VERIFICATION", verifier_role: "FM", external_party: "CUSTOMER", priority: "CRITICAL" },
  { stage_code: "POST_HANDOVER", code: "PT4", title: "7-day check-in", owner_role: "FM", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "LOW" },
  { stage_code: "POST_HANDOVER", code: "PT5", title: "30-day check-in", owner_role: "FM", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "LOW" },
  { stage_code: "POST_HANDOVER", code: "PT6", title: "90-day check-in", owner_role: "FM", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "LOW" },
];

// docs/reference/emergent-business-rules.md §2.4 (T1-T13), extended with PT1-PT6 at the ends.
const DEPENDENCIES: [string, string][] = [
  ["PT1", "T1"],
  ["T1", "T2"],
  ["T2", "T3"],
  ["T2", "T4"],
  ["T2", "T7"],
  ["T3", "T5"],
  ["T5", "T6"],
  ["T7", "T8"],
  ["T6", "T9"],
  ["T8", "T9"],
  ["T9", "T10"],
  ["T6", "PT2"],
  ["T11", "T12"],
  ["T10", "T13"],
  ["T12", "T13"],
  ["PT3", "T13"],
  ["T13", "PT4"],
  ["PT4", "PT5"],
  ["PT5", "PT6"],
];

const TEMPLATE_ID = "jt_pranava_standard";
const VERSION_ID = "jtv_pranava_standard_v1";

export async function seedJourneyStandard(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM journey_template WHERE code = 'PRANAVA_STANDARD'`
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent, mirrors seed/permissions.ts

  await db.query(
    `INSERT INTO journey_template (id, code, name, scope) VALUES ($1,'PRANAVA_STANDARD','Pranava Standard Journey','STANDARD')`,
    [TEMPLATE_ID]
  );
  await db.query(
    `INSERT INTO journey_template_version (id, template_id, version, status, published_at, migration_rule, change_note)
     VALUES ($1,$2,1,'PUBLISHED',now(),'NEW_JOURNEYS_ONLY',$3)`,
    [VERSION_ID, TEMPLATE_ID, "Initial seed — 12 generic stages (05-journey-templates.md p45 §34.2)."]
  );

  const stageIds = new Map<string, string>();
  for (const [i, stage] of STAGES.entries()) {
    const stageId = `${VERSION_ID}_${stage.code.toLowerCase()}`;
    stageIds.set(stage.code, stageId);
    await db.query(
      `INSERT INTO journey_stage_template
        (id, version_id, code, name, customer_name, sort_order, stream, customer_visible,
         planned_duration_days, owner_department, is_mandatory, condition_expr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        stageId, VERSION_ID, stage.code, stage.name, stage.customer_name, i + 1, stage.stream,
        stage.customer_visible ?? true, stage.planned_duration_days, stage.owner_department,
        stage.is_mandatory ?? true, stage.condition_expr ?? null,
      ]
    );
  }

  for (const [i, task] of TASKS.entries()) {
    const stageId = stageIds.get(task.stage_code);
    if (!stageId) throw new Error(`journey-standard seed: unknown stage_code "${task.stage_code}" for task ${task.code}`);
    await db.query(
      `INSERT INTO journey_task_template
        (id, stage_template_id, code, title, customer_title, owner_role, task_type, execution_type,
         verifier_role, approver_role, external_party, required_document_category, checklist_items,
         priority, condition_expr, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)`,
      [
        `${VERSION_ID}_${task.code.toLowerCase()}`, stageId, task.code, task.title, task.customer_title ?? null,
        task.owner_role, task.task_type, task.execution_type, task.verifier_role ?? null,
        task.approver_role ?? null, task.external_party ?? null, task.required_document_category ?? null,
        JSON.stringify(task.checklist_items ?? []), task.priority ?? "MEDIUM", task.condition_expr ?? null, i + 1,
      ]
    );
  }

  for (const [from, to] of DEPENDENCIES) {
    await db.query(
      `INSERT INTO journey_dependency (version_id, from_task_code, to_task_code, kind) VALUES ($1,$2,$3,'FINISH_TO_START')`,
      [VERSION_ID, from, to]
    );
  }
}
