import { db } from "../db";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { deriveStatus, type ClockStatus } from "./engine";
import { readVersionContent } from "./templates";
import { asDateStr } from "./calendar";

// Stage/Task detail screen (06-timeline-sla-engine.md Screens: "dates, clock with pause history,
// dependencies, evidence link to the Action"). A dedicated read model rather than folding this
// into getJourneyForBooking's per-journey payload — most tasks have no pause history and no
// dependency, so paying for sla_clock_event/journey_dependency rows on every task in the whole
// journey (the common Timeline-screen case) would be wasted weight; this is fetched only when a
// user actually opens one task's detail.

export interface ClockPauseEvent {
  at: string;
  kind: "START" | "PAUSE" | "RESUME" | "STOP" | "RESET";
  reason: string | null;
}

export interface TaskDependencyRef {
  task_code: string;
  kind: "FINISH_TO_START" | "START_TO_START";
  lag_days: number;
}

export interface TaskInstanceDetail {
  id: string;
  task_code: string;
  title: string;
  customer_title: string | null;
  status: string;
  action_id: string | null;
  baseline_start: string;
  baseline_end: string;
  planned_start: string;
  planned_end: string;
  forecast_start: string;
  forecast_end: string;
  actual_start: string | null;
  actual_end: string | null;
  clock: {
    due_at: string;
    stopped_at: string | null;
    outcome: "ON_TIME" | "LATE" | null;
    status: ClockStatus;
    total_paused_seconds: number;
    events: ClockPauseEvent[];
  } | null;
  depends_on: TaskDependencyRef[];
  blocks: TaskDependencyRef[];
}

export async function getTaskInstanceDetail(taskInstanceId: string, ctx: Ctx): Promise<TaskInstanceDetail> {
  requireRole(ctx, STAFF_ROLES);
  const t = await db.query<{
    id: string; task_code: string; status: string; action_id: string | null; sla_clock_id: string | null;
    baseline_start: string | Date; baseline_end: string | Date; planned_start: string | Date; planned_end: string | Date;
    forecast_start: string | Date; forecast_end: string | Date; actual_start: string | Date | null; actual_end: string | Date | null;
    journey_id: string; template_version_id: string;
  }>(
    `SELECT ti.id, ti.task_code, ti.status, ti.action_id, ti.sla_clock_id,
            ti.baseline_start, ti.baseline_end, ti.planned_start, ti.planned_end,
            ti.forecast_start, ti.forecast_end, ti.actual_start, ti.actual_end,
            si.journey_id, ji.template_version_id
       FROM task_instance ti
       JOIN stage_instance si ON si.id = ti.stage_instance_id
       JOIN journey_instance ji ON ji.id = si.journey_id
      WHERE ti.id = $1`,
    [taskInstanceId]
  );
  if (!t.rows[0]) throw new AppError("not_found", "task instance not found");
  const row = t.rows[0];

  const { stages, dependencies = [] } = await readVersionContent(row.template_version_id, db);
  const taskTemplate = stages.flatMap((s) => s.tasks).find((task) => task.code === row.task_code);

  let clock: TaskInstanceDetail["clock"] = null;
  if (row.sla_clock_id) {
    const c = await db.query<{ due_at: string; stopped_at: string | null; outcome: "ON_TIME" | "LATE" | null; total_paused_seconds: number; due_soon_lead_days: number }>(
      `SELECT sc.due_at, sc.stopped_at, sc.outcome, sc.total_paused_seconds, sp.due_soon_lead_days
         FROM sla_clock sc JOIN sla_policy sp ON sp.id = sc.policy_id WHERE sc.id = $1`,
      [row.sla_clock_id]
    );
    const events = await db.query<{ at: string; kind: ClockPauseEvent["kind"]; reason: string | null }>(
      `SELECT at, kind, reason FROM sla_clock_event WHERE clock_id = $1 ORDER BY at`,
      [row.sla_clock_id]
    );
    const cr = c.rows[0];
    clock = {
      due_at: new Date(cr.due_at).toISOString(),
      stopped_at: cr.stopped_at ? new Date(cr.stopped_at).toISOString() : null,
      outcome: cr.outcome,
      status: deriveStatus({ now: new Date().toISOString(), dueAt: cr.due_at, stoppedAt: cr.stopped_at, outcome: cr.outcome, dueSoonLeadDays: cr.due_soon_lead_days, atRisk: false }),
      total_paused_seconds: cr.total_paused_seconds,
      events: events.rows.map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, reason: e.reason })),
    };
  }

  const depends_on = dependencies.filter((d) => d.to_task_code === row.task_code).map((d) => ({ task_code: d.from_task_code, kind: d.kind, lag_days: d.lag_days ?? 0 }));
  const blocks = dependencies.filter((d) => d.from_task_code === row.task_code).map((d) => ({ task_code: d.to_task_code, kind: d.kind, lag_days: d.lag_days ?? 0 }));

  return {
    id: row.id,
    task_code: row.task_code,
    title: taskTemplate?.title ?? row.task_code,
    customer_title: taskTemplate?.customer_title ?? null,
    status: row.status,
    action_id: row.action_id,
    baseline_start: asDateStr(row.baseline_start),
    baseline_end: asDateStr(row.baseline_end),
    planned_start: asDateStr(row.planned_start),
    planned_end: asDateStr(row.planned_end),
    forecast_start: asDateStr(row.forecast_start),
    forecast_end: asDateStr(row.forecast_end),
    actual_start: row.actual_start ? asDateStr(row.actual_start) : null,
    actual_end: row.actual_end ? asDateStr(row.actual_end) : null,
    clock,
    depends_on,
    blocks,
  };
}
