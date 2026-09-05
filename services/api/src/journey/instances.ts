import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike, type EventInput } from "../events";
import { requireRole, STAFF_ROLES, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { readVersionContent, type StageInput, type TaskInput } from "./templates";
import { evaluateCondition } from "./dsl";
import { computeStageSchedule, deriveStageEdges, deriveStatus, type ClockStatus } from "./engine";
import type { CalendarRow } from "./calendar";
import { asDateStr } from "./calendar";
import { startClock, type SlaPolicyRow } from "./sla";
import { createAction, closeAction, approveAction, actionIsApprovalFamily, setActionClock, resetActionForReopen } from "../actions/core";
import { EXECUTION_TYPE_TO_ACTION_TYPE } from "../seed/action-types";

// Journey instantiation + lifecycle (06-timeline-sla-engine.md). Not in this slice (deliberate
// scope cut, logged in TODO.md): timeline_plan_revision/timeline_forecast_revision endpoints
// (planned/forecast dates equal baseline until those exist — variance/slippage are always 0,
// which is honest, not faked), entry_gate_expr evaluation (references gates from 07/08/16/19,
// none built), conditional re-evaluation on customer.residency_changed/change_request.created
// (rule 1's "improves on E §2.5" — only the at-creation evaluation is done here),
// ProjectJourneyControl dashboard, Policy Studio SLA/Calendar/DelayReason CRUD screens.
// completeTaskInstance now delegates to actions/core.ts's closeAction/approveAction (10) for the
// real evidence-gated close (APPROVAL-family tasks, e.g. T6, close via approveAction — closeAction
// always refuses that family) — every task_instance gets a real action row at creation (rule 2's
// one wired Source), kept in sync at the two other divergence points: cascadeActionable's new SLA
// clock (setActionClock) and reopenTaskInstance's transitive reset (resetActionForReopen).
// KNOWN GAP: this is task_instance -> action mirroring only. A caller who hits a task-backed
// action's own routes directly (POST /api/actions/:id/approve|close|cancel) closes the action
// without updating task_instance/cascading/rolling up — unreachable today since 10's UI
// (ActionDrawer/Queues.tsx) isn't built, so nothing calls those routes for a task-backed action
// yet, but must be fixed (event subscriber on action.closed, rule 7's original plan, is the
// natural fix) before that UI ships.

async function getCalendar(tx: DbLike): Promise<CalendarRow> {
  const r = await tx.query<{ working_days: unknown; holidays: unknown }>(
    `SELECT working_days, holidays FROM project_calendar ORDER BY id LIMIT 1`
  );
  if (r.rows.length === 0) throw new AppError("validation", "no project_calendar seeded");
  return { working_days: r.rows[0].working_days as number[], holidays: r.rows[0].holidays as string[] };
}

async function resolveTemplateVersionId(projectId: string, tx: DbLike): Promise<string> {
  const project = await tx.query<{ journey_template_version_id: string | null }>(
    `SELECT journey_template_version_id FROM project WHERE id = $1`,
    [projectId]
  );
  if (project.rows[0]?.journey_template_version_id) return project.rows[0].journey_template_version_id;

  // Rule 1 fallback: the project has no assigned template — use Standard's latest PUBLISHED.
  const std = await tx.query<{ id: string }>(
    `SELECT jtv.id FROM journey_template_version jtv
       JOIN journey_template jt ON jt.id = jtv.template_id
      WHERE jt.code = 'PRANAVA_STANDARD' AND jtv.status = 'PUBLISHED'
      ORDER BY jtv.version DESC LIMIT 1`
  );
  if (!std.rows[0]) throw new AppError("validation", "no published journey template available (not even Standard)");
  return std.rows[0].id;
}

async function buildConditionContext(bookingId: string, unitId: string, tx: DbLike) {
  const customer = await tx.query<{ residency: string }>(
    `SELECT c.residency FROM customer c
       JOIN booking_applicant ba ON ba.customer_id = c.id
      WHERE ba.booking_id = $1 AND ba.role = 'primary'`,
    [bookingId]
  );
  const unit = await tx.query<{ product_type: string }>(`SELECT product_type FROM unit WHERE id = $1`, [unitId]);
  return {
    customer: { residency: customer.rows[0]?.residency ?? null },
    // No change-request table exists yet (08) — always false at instantiation time, which is
    // correct: a booking can't have change requests before its journey exists.
    booking: { has_change_requests: false },
    unit: { product_type: unit.rows[0]?.product_type ?? null },
    project: {},
  };
}

function passesCondition(expr: string | null | undefined, ctx: ReturnType<typeof buildConditionContext> extends Promise<infer T> ? T : never): boolean {
  if (!expr) return true;
  return evaluateCondition(expr, ctx);
}

async function getTaskSlaPolicy(taskCode: string, tx: DbLike): Promise<SlaPolicyRow | null> {
  const r = await tx.query<SlaPolicyRow>(
    `SELECT id, duration_value, duration_unit FROM sla_policy
      WHERE applies_to = 'TASK_CODE' AND target_ref = $1
      ORDER BY version DESC LIMIT 1`,
    [taskCode]
  );
  return r.rows[0] ?? null;
}

/** Rule 1 + 2: instantiate a journey from the project's published template (fallback Standard),
 *  filter conditional stages/tasks, compute baseline/planned/forecast dates (equal at creation)
 *  along the dependency graph, and start SLA clocks for every task with no unmet predecessor
 *  (rule 5). Idempotent — a booking already has at most one journey_instance. */
export async function instantiateJourneyForBooking(
  bookingId: string,
  tx: DbLike,
  // The real caller (journey/subscribers.ts) runs after commit, outside any live Ctx — it
  // forwards the actor_user_id/actor_kind carried on the triggering sales_handover.accepted
  // event instead, so "who started this journey" still traces to the CRM user who accepted the
  // booking, not a synthetic SYSTEM stamp. Defaults to SYSTEM for direct/test callers.
  actor?: Pick<EventInput, "actor_user_id" | "actor_kind">
): Promise<string> {
  const existing = await tx.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1`, [bookingId]);
  if (existing.rows[0]) return existing.rows[0].id;

  const booking = await tx.query<{ project_id: string; unit_id: string }>(
    `SELECT project_id, unit_id FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (!booking.rows[0]) throw new AppError("not_found", "booking not found");
  const { project_id: projectId, unit_id: unitId } = booking.rows[0];

  const versionId = await resolveTemplateVersionId(projectId, tx);
  const content = await readVersionContent(versionId, tx);
  const conditionCtx = await buildConditionContext(bookingId, unitId, tx);
  const calendar = await getCalendar(tx);

  const stages = content.stages.filter((s) => passesCondition(s.condition_expr, conditionCtx));
  const stageCodes = new Set(stages.map((s) => s.code));

  const journeyId = "ji_" + randomUUID().slice(0, 8);
  const startDate = new Date().toISOString().slice(0, 10);
  await tx.query(
    `INSERT INTO journey_instance (id, booking_id, project_id, template_version_id) VALUES ($1,$2,$3,$4)`,
    [journeyId, bookingId, projectId, versionId]
  );

  const taskStageCode = new Map<string, string>();
  const stageTasks = new Map<string, TaskInput[]>();
  for (const stage of stages) {
    const tasks = stage.tasks.filter((t) => passesCondition(t.condition_expr, conditionCtx));
    stageTasks.set(stage.code, tasks);
    for (const t of tasks) taskStageCode.set(t.code, stage.code);
  }

  const deps = (content.dependencies ?? [])
    .filter((d) => taskStageCode.has(d.from_task_code) && taskStageCode.has(d.to_task_code))
    .map((d) => ({ from_task_code: d.from_task_code, to_task_code: d.to_task_code, lag_days: d.lag_days ?? 0 }));
  const stageEdges = deriveStageEdges(taskStageCode, deps);
  const schedule = computeStageSchedule(
    stages.map((s) => ({ code: s.code, planned_duration_days: s.planned_duration_days })),
    stageEdges,
    startDate,
    calendar
  );

  // A task is actionable at creation only if it has no incoming edge at all (rule 5).
  const hasIncoming = new Set(deps.map((d) => d.to_task_code));

  for (const stage of stages) {
    const window = schedule.get(stage.code)!;
    const stageInstanceId = `${journeyId}_${stage.code.toLowerCase()}`;
    await tx.query(
      `INSERT INTO stage_instance
        (id, journey_id, stage_code, baseline_start, baseline_end, planned_start, planned_end, forecast_start, forecast_end)
       VALUES ($1,$2,$3,$4,$5,$4,$5,$4,$5)`,
      [stageInstanceId, journeyId, stage.code, window.start, window.end]
    );

    for (const task of stageTasks.get(stage.code) ?? []) {
      const taskInstanceId = `${stageInstanceId}_${task.code.toLowerCase()}`;
      let slaClockId: string | null = null;
      if (!hasIncoming.has(task.code)) {
        const policy = await getTaskSlaPolicy(task.code, tx);
        if (policy) slaClockId = await startClock({ subject_type: "task_instance", subject_id: taskInstanceId, policy, calendar }, tx);
      }
      await tx.query(
        `INSERT INTO task_instance
          (id, stage_instance_id, task_code, baseline_start, baseline_end, planned_start, planned_end,
           forecast_start, forecast_end, sla_clock_id)
         VALUES ($1,$2,$3,$4,$5,$4,$5,$4,$5,$6)`,
        [taskInstanceId, stageInstanceId, task.code, window.start, window.end, slaClockId]
      );

      // Rule 2 (10): the task row references its own action, created here regardless of whether
      // it's immediately actionable (an un-actionable task's action just starts New, no clock).
      const actionId = await createAction(
        {
          type: EXECUTION_TYPE_TO_ACTION_TYPE[task.execution_type],
          title: task.title,
          project_id: projectId,
          source_module: "journey",
          source_entity_type: "task_instance",
          source_entity_id: taskInstanceId,
          booking_id: bookingId,
          unit_id: unitId,
          owner_role: task.owner_role,
          // No due_at duplication here — sla_clock.due_at (joined via sla_clock_id) is the one
          // source of truth, same as task_instance's own read model already does.
          priority: task.priority,
          sla_clock_id: slaClockId,
          customer_visible: task.customer_visible,
          customer_title: task.customer_title ?? null,
          approver_role: task.approver_role ?? null,
          verifier_role: task.verifier_role ?? null,
          checklist: (task.checklist_items ?? []).map((label) => ({ label: String(label) })),
          origin: "AUTO",
        },
        tx
      );
      await tx.query(`UPDATE task_instance SET action_id = $2 WHERE id = $1`, [taskInstanceId, actionId]);
    }
  }

  await appendEvent(tx, {
    type: "journey.started",
    entity_type: "journey_instance",
    entity_id: journeyId,
    project_id: projectId,
    booking_id: bookingId,
    unit_id: unitId,
    payload: { template_version_id: versionId, stage_count: stages.length },
    ...actor,
  });

  return journeyId;
}

async function requireJourney(journeyId: string, tx: DbLike): Promise<{ status: string; project_id: string }> {
  const r = await tx.query<{ status: string; project_id: string }>(
    `SELECT status, project_id FROM journey_instance WHERE id = $1`,
    [journeyId]
  );
  if (!r.rows[0]) throw new AppError("not_found", "journey not found");
  return r.rows[0];
}

/** Rule 8: hold/resume/close all require a reason. Close is MANAGEMENT/SUPER_ADMIN only. */
export async function holdJourney(journeyId: string, reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const j = await requireJourney(journeyId, tx);
    if (j.status !== "ACTIVE") throw new AppError("conflict", "only an ACTIVE journey can be held");
    await tx.query(`UPDATE journey_instance SET status = 'ON_HOLD', hold_reason = $2 WHERE id = $1`, [journeyId, reason]);
    await appendEvent(tx, { type: "journey.held", entity_type: "journey_instance", entity_id: journeyId, project_id: j.project_id, payload: { reason }, ...actorFields(ctx) });
  });
}

export async function resumeJourney(journeyId: string, reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const j = await requireJourney(journeyId, tx);
    if (j.status !== "ON_HOLD") throw new AppError("conflict", "only an ON_HOLD journey can be resumed");
    await tx.query(`UPDATE journey_instance SET status = 'ACTIVE', hold_reason = NULL WHERE id = $1`, [journeyId]);
    await appendEvent(tx, { type: "journey.resumed", entity_type: "journey_instance", entity_id: journeyId, project_id: j.project_id, payload: { reason }, ...actorFields(ctx) });
  });
}

export async function closeJourney(journeyId: string, reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, POLICY_STUDIO_ROLES); // rule 8: MANAGEMENT/SUPER_ADMIN only
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const j = await requireJourney(journeyId, tx);
    if (j.status === "CLOSED" || j.status === "CANCELLED") throw new AppError("conflict", "journey is already closed");
    await tx.query(`UPDATE journey_instance SET status = 'CLOSED', closed_at = now(), close_reason = $2 WHERE id = $1`, [journeyId, reason]);
    await appendEvent(tx, { type: "journey.closed", entity_type: "journey_instance", entity_id: journeyId, project_id: j.project_id, payload: { reason }, ...actorFields(ctx) });
  });
}

interface TaskInstanceRow {
  id: string;
  task_code: string;
  stage_instance_id: string;
  status: string;
  sla_clock_id: string | null;
  action_id: string | null;
}

/** Rule 5 cascade: once a task completes, any dependent task whose every predecessor is now
 *  Closed/NOT_APPLICABLE-with-counts_as_done becomes actionable and gets its SLA clock started. */
async function cascadeActionable(journeyId: string, completedTaskCode: string, calendar: CalendarRow, tx: DbLike): Promise<void> {
  const journey = await tx.query<{ template_version_id: string }>(`SELECT template_version_id FROM journey_instance WHERE id = $1`, [journeyId]);
  const versionId = journey.rows[0].template_version_id;

  const dependents = await tx.query<{ from_task_code: string; to_task_code: string; counts_as_done: boolean }>(
    `SELECT from_task_code, to_task_code, counts_as_done FROM journey_dependency WHERE version_id = $1 AND from_task_code = $2`,
    [versionId, completedTaskCode]
  );

  for (const dep of dependents.rows) {
    const target = await tx.query<TaskInstanceRow>(
      `SELECT ti.id, ti.task_code, ti.stage_instance_id, ti.status, ti.sla_clock_id, ti.action_id FROM task_instance ti
         JOIN stage_instance si ON si.id = ti.stage_instance_id
        WHERE si.journey_id = $1 AND ti.task_code = $2`,
      [journeyId, dep.to_task_code]
    );
    if (!target.rows[0] || target.rows[0].sla_clock_id) continue; // already actionable or doesn't exist

    const allPreds = await tx.query<{ from_task_code: string; counts_as_done: boolean }>(
      `SELECT from_task_code, counts_as_done FROM journey_dependency WHERE version_id = $1 AND to_task_code = $2`,
      [versionId, dep.to_task_code]
    );
    const predStates = await tx.query<{ task_code: string; status: string }>(
      `SELECT ti.task_code, ti.status FROM task_instance ti
         JOIN stage_instance si ON si.id = ti.stage_instance_id
        WHERE si.journey_id = $1 AND ti.task_code = ANY($2::text[])`,
      [journeyId, allPreds.rows.map((p) => p.from_task_code)]
    );
    const statusByCode = new Map(predStates.rows.map((p) => [p.task_code, p.status]));
    const allSatisfied = allPreds.rows.every((p) => {
      const status = statusByCode.get(p.from_task_code);
      return status === "Closed" || (p.counts_as_done && status === "Cancelled");
    });
    if (!allSatisfied) continue;

    const policy = await getTaskSlaPolicy(dep.to_task_code, tx);
    if (!policy) continue;
    const clockId = await startClock({ subject_type: "task_instance", subject_id: target.rows[0].id, policy, calendar }, tx);
    await tx.query(`UPDATE task_instance SET sla_clock_id = $2 WHERE id = $1`, [target.rows[0].id, clockId]);
    // Keep the action's own clock reference in sync (10) — same clock, two pointers, not a
    // second clock started (see actions/core.ts's setActionClock doc comment).
    if (target.rows[0].action_id) await setActionClock(target.rows[0].action_id, clockId, tx);
  }
}

async function refreshStageAndJourneyRollup(journeyId: string, stageInstanceId: string, ctx: Ctx, tx: DbLike): Promise<void> {
  const tasks = await tx.query<{ status: string }>(`SELECT status FROM task_instance WHERE stage_instance_id = $1`, [stageInstanceId]);
  const total = tasks.rows.length;
  const done = tasks.rows.filter((t) => t.status === "Closed" || t.status === "Cancelled").length;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);
  const stageDone = total > 0 && done === total;
  await tx.query(
    `UPDATE stage_instance SET progress_pct = $2, status = CASE WHEN $3 THEN 'COMPLETED' ELSE status END, actual_end = CASE WHEN $3 THEN CURRENT_DATE ELSE actual_end END WHERE id = $1`,
    [stageInstanceId, progressPct, stageDone]
  );
  if (stageDone) {
    const stage = await tx.query<{ stage_code: string }>(`SELECT stage_code FROM stage_instance WHERE id = $1`, [stageInstanceId]);
    await appendEvent(tx, { type: "stage.completed", entity_type: "stage_instance", entity_id: stageInstanceId, payload: { stage_code: stage.rows[0]?.stage_code }, ...actorFields(ctx) });
  }

  // Rule 9: journey health = worst of its open tasks' statuses.
  const openTasks = await tx.query<{ id: string; sla_clock_id: string | null }>(
    `SELECT ti.id, ti.sla_clock_id FROM task_instance ti
       JOIN stage_instance si ON si.id = ti.stage_instance_id
      WHERE si.journey_id = $1 AND ti.status NOT IN ('Closed', 'Cancelled')`,
    [journeyId]
  );
  const severity: Record<ClockStatus, number> = { ON_TRACK: 0, DUE_SOON: 1, AT_RISK: 2, OVERDUE: 3, COMPLETED_ON_TIME: -1, COMPLETED_LATE: -1 };
  let worst: "ON_TRACK" | "DUE_SOON" | "AT_RISK" | "OVERDUE" = "ON_TRACK";
  for (const t of openTasks.rows) {
    if (!t.sla_clock_id) continue; // not yet actionable — no clock, no health contribution
    const clock = await tx.query<{ due_at: string; due_soon_lead_days: number }>(
      `SELECT sc.due_at, sp.due_soon_lead_days FROM sla_clock sc JOIN sla_policy sp ON sp.id = sc.policy_id WHERE sc.id = $1`,
      [t.sla_clock_id]
    );
    const status = deriveStatus({ now: new Date().toISOString(), dueAt: clock.rows[0].due_at, stoppedAt: null, outcome: null, dueSoonLeadDays: clock.rows[0].due_soon_lead_days, atRisk: false });
    if (severity[status] > severity[worst]) worst = status as typeof worst;
  }
  await tx.query(`UPDATE journey_instance SET health = $2 WHERE id = $1`, [journeyId, worst]);
}

/** Closes the task's Action (10's evidence-gated close — the real close path now that Universal
 *  Action exists), then cascades actionability to dependents (rule 5) and refreshes stage/journey
 *  rollups. task_instance.status still tracks its own copy of the same Appendix A status (06's
 *  Data table models it that way); closeAction is the source of truth, this just mirrors it. */
export async function completeTaskInstance(taskInstanceId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, async (tx) => {
    const t = await tx.query<{ task_code: string; stage_instance_id: string; status: string; action_id: string | null }>(
      `SELECT task_code, stage_instance_id, status, action_id FROM task_instance WHERE id = $1`,
      [taskInstanceId]
    );
    if (!t.rows[0]) throw new AppError("not_found", "task instance not found");
    if (t.rows[0].status === "Closed") throw new AppError("conflict", "task already closed");
    if (!t.rows[0].action_id) throw new AppError("conflict", "task instance has no action (not yet actionable?)");

    const stage = await tx.query<{ journey_id: string }>(`SELECT journey_id FROM stage_instance WHERE id = $1`, [t.rows[0].stage_instance_id]);
    const journeyId = stage.rows[0].journey_id;

    // APPROVAL-family actions close via approveAction (they must already be Ready for Approval —
    // closeAction always refuses APPROVAL-family, see actions/core.ts's checkEvidenceGate).
    if (await actionIsApprovalFamily(t.rows[0].action_id, tx)) {
      await approveAction(t.rows[0].action_id, undefined, ctx, tx);
    } else {
      await closeAction(t.rows[0].action_id, undefined, ctx, tx); // evidence gate (rule 4) throws here if unmet
    }
    await tx.query(`UPDATE task_instance SET status = 'Closed', actual_end = CURRENT_DATE WHERE id = $1`, [taskInstanceId]);

    const calendar = await getCalendar(tx);
    await cascadeActionable(journeyId, t.rows[0].task_code, calendar, tx);
    await refreshStageAndJourneyRollup(journeyId, t.rows[0].stage_instance_id, ctx, tx);
  });
}

/** Rule 7: reopening resets this task and every transitive dependent back to Not Started
 *  ("New"), clearing actuals, and voids their SLA clocks — a fresh clock starts only once the
 *  chain becomes actionable again via completeTaskInstance. Requires a reason (logged on the event). */
export async function reopenTaskInstance(taskInstanceId: string, reason: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  await withTx(undefined, async (tx) => {
    const t = await tx.query<{ task_code: string; stage_instance_id: string }>(
      `SELECT task_code, stage_instance_id FROM task_instance WHERE id = $1`,
      [taskInstanceId]
    );
    if (!t.rows[0]) throw new AppError("not_found", "task instance not found");
    const stage = await tx.query<{ journey_id: string }>(`SELECT journey_id FROM stage_instance WHERE id = $1`, [t.rows[0].stage_instance_id]);
    const journeyId = stage.rows[0].journey_id;
    const version = await tx.query<{ template_version_id: string }>(`SELECT template_version_id FROM journey_instance WHERE id = $1`, [journeyId]);
    const versionId = version.rows[0].template_version_id;

    const toReset = new Set<string>([t.rows[0].task_code]);
    let frontier = [t.rows[0].task_code];
    while (frontier.length > 0) {
      const next = await tx.query<{ to_task_code: string }>(
        `SELECT to_task_code FROM journey_dependency WHERE version_id = $1 AND from_task_code = ANY($2::text[])`,
        [versionId, frontier]
      );
      frontier = next.rows.map((r) => r.to_task_code).filter((code) => !toReset.has(code));
      for (const code of frontier) toReset.add(code);
    }

    for (const code of toReset) {
      const instance = await tx.query<{ id: string; sla_clock_id: string | null; action_id: string | null }>(
        `SELECT ti.id, ti.sla_clock_id, ti.action_id FROM task_instance ti
           JOIN stage_instance si ON si.id = ti.stage_instance_id
          WHERE si.journey_id = $1 AND ti.task_code = $2`,
        [journeyId, code]
      );
      if (!instance.rows[0]) continue;
      await tx.query(
        `UPDATE task_instance SET status = 'New', actual_start = NULL, actual_end = NULL, sla_clock_id = NULL WHERE id = $1`,
        [instance.rows[0].id]
      );
      // Mirror-image reset on the action side (10) — otherwise a reopened task's action stays
      // stuck Closed while task_instance goes back to New (see actions/core.ts's doc comment).
      if (instance.rows[0].action_id) await resetActionForReopen(instance.rows[0].action_id, reason, tx);
    }

    await appendEvent(tx, {
      type: "task_instance.reopened",
      entity_type: "task_instance",
      entity_id: taskInstanceId,
      payload: { task_code: t.rows[0].task_code, reset_count: toReset.size, reason },
      ...actorFields(ctx),
    });
    await refreshStageAndJourneyRollup(journeyId, t.rows[0].stage_instance_id, ctx, tx);
  });
}

export interface JourneyReadModel {
  id: string;
  status: string;
  health: string;
  hold_reason: string | null;
  started_at: string;
  stages: {
    stage_code: string;
    status: string;
    progress_pct: number;
    baseline_start: string;
    baseline_end: string;
    planned_start: string;
    planned_end: string;
    forecast_start: string;
    forecast_end: string;
    variance_days: number;
    slippage_days: number;
    tasks: { task_code: string; status: string; clock_status: ClockStatus | null; due_at: string | null }[];
  }[];
}

function daysBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / (24 * 60 * 60 * 1000));
}

/** Rule 3: variance = planned - baseline, slippage = forecast - planned, exposed per stage. */
export async function getJourneyForBooking(bookingId: string, ctx: Ctx): Promise<JourneyReadModel | null> {
  requireRole(ctx, STAFF_ROLES);
  const journey = await db.query<{ id: string; status: string; health: string; hold_reason: string | null; started_at: string }>(
    `SELECT id, status, health, hold_reason, started_at FROM journey_instance WHERE booking_id = $1`,
    [bookingId]
  );
  if (!journey.rows[0]) return null;
  const j = journey.rows[0];

  const stages = await db.query<{
    id: string; stage_code: string; status: string; progress_pct: number;
    baseline_start: string | Date; baseline_end: string | Date; planned_start: string | Date; planned_end: string | Date;
    forecast_start: string | Date; forecast_end: string | Date;
  }>(
    `SELECT id, stage_code, status, progress_pct, baseline_start, baseline_end, planned_start, planned_end, forecast_start, forecast_end
       FROM stage_instance WHERE journey_id = $1 ORDER BY baseline_start`,
    [j.id]
  );

  const result: JourneyReadModel["stages"] = [];
  for (const stage of stages.rows) {
    const tasks = await db.query<{ task_code: string; status: string; sla_clock_id: string | null }>(
      `SELECT task_code, status, sla_clock_id FROM task_instance WHERE stage_instance_id = $1 ORDER BY task_code`,
      [stage.id]
    );
    const taskRows: JourneyReadModel["stages"][number]["tasks"] = [];
    for (const t of tasks.rows) {
      if (!t.sla_clock_id) {
        taskRows.push({ task_code: t.task_code, status: t.status, clock_status: null, due_at: null });
        continue;
      }
      const clock = await db.query<{ due_at: string; stopped_at: string | null; outcome: "ON_TIME" | "LATE" | null; due_soon_lead_days: number }>(
        `SELECT sc.due_at, sc.stopped_at, sc.outcome, sp.due_soon_lead_days FROM sla_clock sc JOIN sla_policy sp ON sp.id = sc.policy_id WHERE sc.id = $1`,
        [t.sla_clock_id]
      );
      const c = clock.rows[0];
      const status = deriveStatus({ now: new Date().toISOString(), dueAt: c.due_at, stoppedAt: c.stopped_at, outcome: c.outcome, dueSoonLeadDays: c.due_soon_lead_days, atRisk: false });
      taskRows.push({ task_code: t.task_code, status: t.status, clock_status: status, due_at: new Date(c.due_at).toISOString() });
    }
    result.push({
      stage_code: stage.stage_code,
      status: stage.status,
      progress_pct: stage.progress_pct,
      baseline_start: asDateStr(stage.baseline_start),
      baseline_end: asDateStr(stage.baseline_end),
      planned_start: asDateStr(stage.planned_start),
      planned_end: asDateStr(stage.planned_end),
      forecast_start: asDateStr(stage.forecast_start),
      forecast_end: asDateStr(stage.forecast_end),
      variance_days: daysBetween(stage.planned_end, stage.baseline_end),
      slippage_days: daysBetween(stage.forecast_end, stage.planned_end),
      tasks: taskRows,
    });
  }

  return { id: j.id, status: j.status, health: j.health, hold_reason: j.hold_reason, started_at: j.started_at, stages: result };
}
