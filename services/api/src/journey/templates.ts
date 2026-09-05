import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, type DbLike } from "../events";
import { requireRole, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { validateConditionExpr, evaluateCondition, ConditionExprError } from "./dsl";
import { hasCycle } from "./dependency";

// Journey Template Studio backend (spec 05).

export type Stream = "COMMERCIAL" | "LEGAL" | "FINANCE" | "CONSTRUCTION" | "HANDOVER" | "POST_HANDOVER";
export type TaskType = "MANDATORY" | "CONDITIONAL";
export type ExecutionType = "SIMPLE" | "VERIFICATION" | "EVIDENCE" | "APPROVAL" | "CHECKLIST" | "EXTERNAL";
export type ExternalParty = "CUSTOMER" | "SRO" | "BANK" | "VENDOR";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DependencyKind = "FINISH_TO_START" | "START_TO_START";
export type MigrationRule = "NEW_JOURNEYS_ONLY" | "OFFER_MIGRATION";

export interface TaskInput {
  code: string;
  title: string;
  customer_title?: string;
  owner_role: string;
  task_type: TaskType;
  execution_type: ExecutionType;
  verifier_role?: string;
  approver_role?: string;
  external_party?: ExternalParty;
  required_document_category?: string;
  checklist_items?: unknown[];
  priority?: Priority;
  sla_policy_id?: string;
  condition_expr?: string;
  customer_visible?: boolean;
  sort_order?: number;
}

export interface StageInput {
  code: string;
  name: string;
  customer_name?: string;
  sort_order?: number;
  stream: Stream;
  customer_visible?: boolean;
  planned_duration_days: number;
  owner_department: string;
  entry_gate_expr?: string;
  is_mandatory?: boolean;
  condition_expr?: string;
  tasks: TaskInput[];
  visibility?: { role_code: string; visible: boolean }[];
}

export interface DependencyInput {
  from_task_code: string;
  to_task_code: string;
  kind: DependencyKind;
  lag_days?: number;
}

export interface VersionContentInput {
  stages: StageInput[];
  dependencies?: DependencyInput[];
}

export async function listTemplates(ctx: Ctx) {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  const { rows } = await db.query<{
    id: string;
    code: string;
    name: string;
    scope: string;
    project_id: string | null;
    product_type: string | null;
    latest_version: number | null;
    latest_status: string | null;
  }>(`
    SELECT t.id, t.code, t.name, t.scope, t.project_id, t.product_type,
           v.version AS latest_version, v.status AS latest_status
      FROM journey_template t
      LEFT JOIN LATERAL (
        SELECT version, status FROM journey_template_version
         WHERE template_id = t.id ORDER BY version DESC LIMIT 1
      ) v ON true
     ORDER BY t.scope, t.name
  `);
  return rows;
}

export async function createTemplate(
  input: { code: string; name: string; scope: "STANDARD" | "PROJECT"; project_id?: string; parent_template_id?: string; product_type?: string },
  ctx: Ctx,
  tx: DbLike = db
): Promise<string> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  if (!input.code?.trim() || !input.name?.trim()) throw new AppError("validation", "code and name required");
  if (input.scope === "PROJECT" && !input.project_id) {
    throw new AppError("validation", "project_id required for a PROJECT-scope template", "project_id");
  }
  const id = "jt_" + randomUUID().slice(0, 8);
  await tx.query(
    `INSERT INTO journey_template (id, code, name, scope, project_id, parent_template_id, product_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, input.code.trim(), input.name.trim(), input.scope, input.project_id ?? null, input.parent_template_id ?? null, input.product_type ?? null]
  );
  return id;
}

/** Rule: "draft from current" — copies the latest version's full content (stages, tasks,
 * dependencies, visibility) into a new DRAFT version, or starts empty for a template's first
 * version. Stage/task ids are regenerated (nothing outside this feature references them yet —
 * no journey_instance exists until 06 lands). */
export async function createVersion(templateId: string, ctx: Ctx): Promise<string> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  return withTx(undefined, async (tx) => {
    const tmpl = await tx.query<{ id: string }>(`SELECT id FROM journey_template WHERE id = $1`, [templateId]);
    if (tmpl.rows.length === 0) throw new AppError("not_found", "template not found");

    const latest = await tx.query<{ id: string; version: number }>(
      `SELECT id, version FROM journey_template_version WHERE template_id = $1 ORDER BY version DESC LIMIT 1`,
      [templateId]
    );
    const nextVersion = (latest.rows[0]?.version ?? 0) + 1;
    const versionId = "jtv_" + randomUUID().slice(0, 8);
    await tx.query(
      `INSERT INTO journey_template_version (id, template_id, version, status) VALUES ($1,$2,$3,'DRAFT')`,
      [versionId, templateId, nextVersion]
    );

    if (latest.rows[0]) {
      const content = await readVersionContent(latest.rows[0].id, tx);
      await writeVersionContent(versionId, content, tx);
    }
    return versionId;
  });
}

export async function getVersion(versionId: string, ctx: Ctx) {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  const v = await db.query<{ id: string; template_id: string; version: number; status: string; change_note: string | null }>(
    `SELECT id, template_id, version, status, change_note FROM journey_template_version WHERE id = $1`,
    [versionId]
  );
  if (v.rows.length === 0) throw new AppError("not_found", "version not found");
  const content = await readVersionContent(versionId, db);
  return { ...v.rows[0], ...content };
}

/** Exported for journey/instances.ts (06) — instantiating a journey needs the same nested
 *  stages/tasks/dependencies/visibility read as the Studio's version editor. */
export async function readVersionContent(versionId: string, tx: DbLike): Promise<VersionContentInput> {
  const stages = await tx.query<StageInput & { id: string }>(
    `SELECT id, code, name, customer_name, sort_order, stream, customer_visible, planned_duration_days,
            owner_department, entry_gate_expr, is_mandatory, condition_expr
       FROM journey_stage_template WHERE version_id = $1 ORDER BY sort_order`,
    [versionId]
  );
  const deps = await tx.query<DependencyInput>(
    `SELECT from_task_code, to_task_code, kind, lag_days FROM journey_dependency WHERE version_id = $1`,
    [versionId]
  );
  const result: StageInput[] = [];
  for (const stage of stages.rows) {
    const { id: stageId, ...stageFields } = stage;
    const tasks = await tx.query<TaskInput>(
      `SELECT code, title, customer_title, owner_role, task_type, execution_type, verifier_role, approver_role,
              external_party, required_document_category, checklist_items, priority, sla_policy_id,
              condition_expr, customer_visible, sort_order
         FROM journey_task_template WHERE stage_template_id = $1 ORDER BY sort_order`,
      [stageId]
    );
    const visibility = await tx.query<{ role_code: string; visible: boolean }>(
      `SELECT role_code, visible FROM stage_visibility_rule WHERE stage_template_id = $1`,
      [stageId]
    );
    result.push({ ...stageFields, tasks: tasks.rows, visibility: visibility.rows });
  }
  return { stages: result, dependencies: deps.rows };
}

async function writeVersionContent(versionId: string, content: VersionContentInput, tx: DbLike): Promise<void> {
  for (const [i, stage] of content.stages.entries()) {
    const stageId = "jst_" + randomUUID().slice(0, 8);
    await tx.query(
      `INSERT INTO journey_stage_template
        (id, version_id, code, name, customer_name, sort_order, stream, customer_visible,
         planned_duration_days, owner_department, entry_gate_expr, is_mandatory, condition_expr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        stageId, versionId, stage.code, stage.name, stage.customer_name ?? null, stage.sort_order ?? i,
        stage.stream, stage.customer_visible ?? true, stage.planned_duration_days, stage.owner_department,
        stage.entry_gate_expr ?? null, stage.is_mandatory ?? true, stage.condition_expr ?? null,
      ]
    );
    for (const [j, task] of stage.tasks.entries()) {
      await tx.query(
        `INSERT INTO journey_task_template
          (id, stage_template_id, code, title, customer_title, owner_role, task_type, execution_type,
           verifier_role, approver_role, external_party, required_document_category, checklist_items,
           priority, sla_policy_id, condition_expr, customer_visible, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)`,
        [
          "jtt_" + randomUUID().slice(0, 8), stageId, task.code, task.title, task.customer_title ?? null,
          task.owner_role, task.task_type, task.execution_type, task.verifier_role ?? null,
          task.approver_role ?? null, task.external_party ?? null, task.required_document_category ?? null,
          JSON.stringify(task.checklist_items ?? []), task.priority ?? "MEDIUM", task.sla_policy_id ?? null,
          task.condition_expr ?? null, task.customer_visible ?? true, task.sort_order ?? j,
        ]
      );
    }
    for (const rule of stage.visibility ?? []) {
      await tx.query(
        `INSERT INTO stage_visibility_rule (stage_template_id, role_code, visible) VALUES ($1,$2,$3)`,
        [stageId, rule.role_code, rule.visible]
      );
    }
  }
  for (const dep of content.dependencies ?? []) {
    await tx.query(
      `INSERT INTO journey_dependency (version_id, from_task_code, to_task_code, kind, lag_days) VALUES ($1,$2,$3,$4,$5)`,
      [versionId, dep.from_task_code, dep.to_task_code, dep.kind, dep.lag_days ?? 0]
    );
  }
}

/** Rule 3/4: stage/task edits only while DRAFT; replace-all semantics (see writeVersionContent's
 * doc comment on why regenerating ids is safe today). */
export async function putVersionContent(versionId: string, content: VersionContentInput, ctx: Ctx): Promise<void> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  await withTx(undefined, async (tx) => {
    const v = await tx.query<{ status: string }>(`SELECT status FROM journey_template_version WHERE id = $1`, [versionId]);
    if (v.rows.length === 0) throw new AppError("not_found", "version not found");
    if (v.rows[0].status !== "DRAFT") throw new AppError("conflict", "only a DRAFT version can be edited");

    await tx.query(
      `DELETE FROM stage_visibility_rule WHERE stage_template_id IN (SELECT id FROM journey_stage_template WHERE version_id = $1)`,
      [versionId]
    );
    await tx.query(
      `DELETE FROM journey_task_template WHERE stage_template_id IN (SELECT id FROM journey_stage_template WHERE version_id = $1)`,
      [versionId]
    );
    await tx.query(`DELETE FROM journey_dependency WHERE version_id = $1`, [versionId]);
    await tx.query(`DELETE FROM journey_stage_template WHERE version_id = $1`, [versionId]);

    await writeVersionContent(versionId, content, tx);
  });
}

/** Rule 5: cycle check. Rule 6: fail-closed DSL validation (entry_gate_expr uses the same
 * grammar as condition_expr — both are `scope.field op value`). Rule 3: a PROJECT-scope
 * template may not drop a mandatory stage its STANDARD parent's latest published version has. */
export async function validateForPublish(versionId: string, tx: DbLike = db): Promise<void> {
  const content = await readVersionContent(versionId, tx);

  const exprErrors: string[] = [];
  for (const stage of content.stages) {
    for (const expr of [stage.condition_expr, stage.entry_gate_expr]) {
      if (!expr) continue;
      try {
        validateConditionExpr(expr);
      } catch (e) {
        exprErrors.push(`stage ${stage.code}: ${(e as ConditionExprError).message}`);
      }
    }
    for (const task of stage.tasks) {
      if (!task.condition_expr) continue;
      try {
        validateConditionExpr(task.condition_expr);
      } catch (e) {
        exprErrors.push(`task ${task.code}: ${(e as ConditionExprError).message}`);
      }
    }
  }
  if (exprErrors.length > 0) throw new AppError("validation", `unparseable condition expression(s): ${exprErrors.join("; ")}`);

  if (content.dependencies && hasCycle(content.dependencies)) {
    throw new AppError("validation", "journey_dependency has a cycle — cannot publish");
  }

  const version = await tx.query<{ template_id: string }>(
    `SELECT template_id FROM journey_template_version WHERE id = $1`,
    [versionId]
  );
  const template = await tx.query<{ scope: string; parent_template_id: string | null }>(
    `SELECT scope, parent_template_id FROM journey_template WHERE id = $1`,
    [version.rows[0].template_id]
  );
  if (template.rows[0]?.scope === "PROJECT" && template.rows[0].parent_template_id) {
    const parentLatestPublished = await tx.query<{ id: string }>(
      `SELECT id FROM journey_template_version
        WHERE template_id = $1 AND status = 'PUBLISHED' ORDER BY version DESC LIMIT 1`,
      [template.rows[0].parent_template_id]
    );
    if (parentLatestPublished.rows[0]) {
      const parentContent = await readVersionContent(parentLatestPublished.rows[0].id, tx);
      const parentMandatory = new Set(parentContent.stages.filter((s) => s.is_mandatory).map((s) => s.code));
      const ownCodes = new Set(content.stages.map((s) => s.code));
      const dropped = [...parentMandatory].filter((c) => !ownCodes.has(c));
      if (dropped.length > 0) {
        throw new AppError("validation", `Project override cannot remove Standard mandatory stage(s): ${dropped.join(", ")}`);
      }
    }
  }
}

export async function publishVersion(versionId: string, input: { migration_rule?: MigrationRule; change_note?: string }, ctx: Ctx) {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  return withTx(undefined, async (tx) => {
    const v = await tx.query<{ status: string; template_id: string; version: number }>(
      `SELECT status, template_id, version FROM journey_template_version WHERE id = $1`,
      [versionId]
    );
    if (v.rows.length === 0) throw new AppError("not_found", "version not found");
    if (v.rows[0].status !== "DRAFT") throw new AppError("conflict", "only a DRAFT version can be published");

    await validateForPublish(versionId, tx);

    const priorPublished = await tx.query<{ id: string }>(
      `SELECT id FROM journey_template_version
        WHERE template_id = $1 AND status = 'PUBLISHED' ORDER BY version DESC LIMIT 1`,
      [v.rows[0].template_id]
    );

    await tx.query(
      `UPDATE journey_template_version
          SET status = 'PUBLISHED', published_at = now(), published_by = $2,
              migration_rule = $3, change_note = $4
        WHERE id = $1`,
      [versionId, ctx.actor.user_id, input.migration_rule ?? null, input.change_note ?? null]
    );
    // R0.6c (tracked separately): appendEvent doesn't take an actor param anywhere in this
    // codebase yet, so this follows the same convention as every existing call site.
    await appendEvent(tx, {
      type: "template.version_published",
      entity_type: "journey_template_version",
      entity_id: versionId,
      payload: { template_id: v.rows[0].template_id, version: v.rows[0].version },
    });

    // Rule 2: publishing never alters existing journey_instance rows. OFFER_MIGRATION just
    // raises the event for now — the real per-journey migration Action (10) doesn't exist
    // until that spec lands; this is flagged, not silently skipped.
    if (priorPublished.rows[0] && input.migration_rule === "OFFER_MIGRATION") {
      await appendEvent(tx, {
        type: "journey.migration_offered",
        entity_type: "journey_template_version",
        entity_id: versionId,
        payload: { template_id: v.rows[0].template_id, from_version_id: priorPublished.rows[0].id, to_version_id: versionId },
      });
    }
    return { id: versionId, status: "PUBLISHED" };
  });
}

/** Rule 1: only a PUBLISHED version can be assigned to a project. */
export async function assignTemplateToProject(projectId: string, versionId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  const v = await db.query<{ status: string }>(`SELECT status FROM journey_template_version WHERE id = $1`, [versionId]);
  if (v.rows.length === 0) throw new AppError("not_found", "version not found");
  if (v.rows[0].status !== "PUBLISHED") throw new AppError("validation", "only a PUBLISHED version can be assigned to a project");
  const p = await db.query<{ id: string }>(`SELECT id FROM project WHERE id = $1`, [projectId]);
  if (p.rows.length === 0) throw new AppError("not_found", "project not found");

  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE project SET journey_template_version_id = $1 WHERE id = $2`, [versionId, projectId]);
    await appendEvent(tx, {
      type: "template.assigned_to_project",
      entity_type: "project",
      entity_id: projectId,
      project_id: projectId,
      payload: { version_id: versionId },
    });
  });
}

/** Which stages/tasks would instantiate for a hypothetical booking of this product/residency
 * (rule 5's [E §2.5] one-time-eval improvement is evaluated at real instantiation time by 06 —
 * this is a config-time preview, not journey creation). Unconditional stages/tasks always show. */
export function previewVersion(
  content: VersionContentInput,
  context: { product_type?: string; residency?: string }
): { stage_code: string; task_codes: string[] }[] {
  const evalCtx = { unit: { product_type: context.product_type }, customer: { residency: context.residency } };
  const result: { stage_code: string; task_codes: string[] }[] = [];
  for (const stage of content.stages) {
    if (stage.condition_expr && !safeEvaluate(stage.condition_expr, evalCtx)) continue;
    const taskCodes = stage.tasks
      .filter((t) => !t.condition_expr || safeEvaluate(t.condition_expr, evalCtx))
      .map((t) => t.code);
    result.push({ stage_code: stage.code, task_codes: taskCodes });
  }
  return result;
}

function safeEvaluate(expr: string, ctx: Parameters<typeof evaluateCondition>[1]): boolean {
  try {
    return evaluateCondition(expr, ctx);
  } catch {
    // Already validated at publish time (rule 6) — a throw here means stale/hand-edited data;
    // fail closed (exclude) rather than crash the preview.
    return false;
  }
}
