import type { DbClient } from "../db/types";

// East Crest's Project-scope journey template override (05-journey-templates.md "East Crest
// override (demo only): seven stages mapped onto the standard by code (p47 §35), durations
// from HOMEFLOW-OS.md marked demo"). Demo-only — called from seed.ts's demo path, not
// initDb()'s unconditional config seeding (contrast seed/journey-standard.ts).
//
// Scope cut (logged in TODO.md): HOMEFLOW-OS.md §8's East-Crest-concept table gives category
// mappings ("Flat Selection & Booking Allotment" → "Booking & Allotment", etc.) but no actual
// per-stage day-durations — inventing East Crest-specific numbers with no source would be
// exactly the "hard-code East Crest values" CLAUDE.md forbids. This seeds a real Project-scope
// template — inheriting the Standard's stages/tasks/dependencies unchanged (no durations
// diverge yet) — published and assigned to p_eastcrest, so rule 1 (only PUBLISHED assignable)
// and rule 3 (override never drops a Standard mandatory stage) both exercise against live demo
// data. The actual seven-stage remap with real durations needs Amarsh's numbers before it can
// be seeded honestly.

const TEMPLATE_ID = "jt_eastcrest";
const VERSION_ID = "jtv_eastcrest_v1";
const STANDARD_VERSION_ID = "jtv_pranava_standard_v1"; // seed/journey-standard.ts

export async function seedEastCrestJourney(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM journey_template WHERE code = 'EASTCREST_JOURNEY'`
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  await db.query(
    `INSERT INTO journey_template (id, code, name, scope, project_id, parent_template_id)
     VALUES ($1,'EASTCREST_JOURNEY','East Crest Journey','PROJECT','p_eastcrest','jt_pranava_standard')`,
    [TEMPLATE_ID]
  );
  await db.query(
    `INSERT INTO journey_template_version (id, template_id, version, status, published_at, migration_rule, change_note)
     VALUES ($1,$2,1,'PUBLISHED',now(),'NEW_JOURNEYS_ONLY',$3)`,
    [VERSION_ID, TEMPLATE_ID, "Initial seed — inherits Standard unchanged pending East Crest-specific durations."]
  );

  const stages = await db.query<{ id: string; code: string; name: string; customer_name: string | null; sort_order: number; stream: string; customer_visible: boolean; planned_duration_days: number; owner_department: string; is_mandatory: boolean; condition_expr: string | null }>(
    `SELECT id, code, name, customer_name, sort_order, stream, customer_visible, planned_duration_days,
            owner_department, is_mandatory, condition_expr
       FROM journey_stage_template WHERE version_id = $1 ORDER BY sort_order`,
    [STANDARD_VERSION_ID]
  );
  const stageIdMap = new Map<string, string>();
  for (const s of stages.rows) {
    const newStageId = `${VERSION_ID}_${s.code.toLowerCase()}`;
    stageIdMap.set(s.id, newStageId);
    await db.query(
      `INSERT INTO journey_stage_template
        (id, version_id, code, name, customer_name, sort_order, stream, customer_visible,
         planned_duration_days, owner_department, is_mandatory, condition_expr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [newStageId, VERSION_ID, s.code, s.name, s.customer_name, s.sort_order, s.stream, s.customer_visible,
       s.planned_duration_days, s.owner_department, s.is_mandatory, s.condition_expr]
    );
  }

  const tasks = await db.query<{
    stage_template_id: string; code: string; title: string; customer_title: string | null;
    owner_role: string; task_type: string; execution_type: string; verifier_role: string | null;
    approver_role: string | null; external_party: string | null; required_document_category: string | null;
    checklist_items: unknown; priority: string; condition_expr: string | null; sort_order: number;
  }>(
    `SELECT stage_template_id, code, title, customer_title, owner_role, task_type, execution_type,
            verifier_role, approver_role, external_party, required_document_category, checklist_items,
            priority, condition_expr, sort_order
       FROM journey_task_template WHERE stage_template_id IN (SELECT id FROM journey_stage_template WHERE version_id = $1)
       ORDER BY sort_order`,
    [STANDARD_VERSION_ID]
  );
  for (const t of tasks.rows) {
    const newStageId = stageIdMap.get(t.stage_template_id)!;
    await db.query(
      `INSERT INTO journey_task_template
        (id, stage_template_id, code, title, customer_title, owner_role, task_type, execution_type,
         verifier_role, approver_role, external_party, required_document_category, checklist_items,
         priority, condition_expr, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)`,
      [
        `${VERSION_ID}_${t.code.toLowerCase()}`, newStageId, t.code, t.title, t.customer_title, t.owner_role,
        t.task_type, t.execution_type, t.verifier_role, t.approver_role, t.external_party,
        t.required_document_category, JSON.stringify(t.checklist_items ?? []), t.priority, t.condition_expr, t.sort_order,
      ]
    );
  }

  const deps = await db.query<{ from_task_code: string; to_task_code: string; kind: string; lag_days: number }>(
    `SELECT from_task_code, to_task_code, kind, lag_days FROM journey_dependency WHERE version_id = $1`,
    [STANDARD_VERSION_ID]
  );
  for (const d of deps.rows) {
    await db.query(
      `INSERT INTO journey_dependency (version_id, from_task_code, to_task_code, kind, lag_days) VALUES ($1,$2,$3,$4,$5)`,
      [VERSION_ID, d.from_task_code, d.to_task_code, d.kind, d.lag_days]
    );
  }

  await db.query(`UPDATE project SET journey_template_version_id = $1 WHERE id = 'p_eastcrest'`, [VERSION_ID]);
}
