import { db } from "../db";
import type { DbLike } from "../events";
import { asDateStr } from "./calendar";
import { computeAtRisk } from "./engine";

// Wave D bug 3: deriveStatus already returns AT_RISK when atRisk is true, but every
// caller used to pass false. Facts come only from data that exists — blocked,
// forecast after plan (Wave C writes both dates), or a dependency whose clock is overdue.

async function clockIsOverdue(slaClockId: string | null, now: string, tx: DbLike): Promise<boolean> {
  if (!slaClockId) return false;
  const c = await tx.query<{ due_at: string; stopped_at: string | null }>(
    `SELECT due_at::text AS due_at, stopped_at::text AS stopped_at FROM sla_clock WHERE id = $1`,
    [slaClockId]
  );
  if (!c.rows[0] || c.rows[0].stopped_at) return false;
  return new Date(now).getTime() > new Date(c.rows[0].due_at).getTime();
}

/** Compute atRisk for a clock from blocked / forecast-after-plan / dependency-overdue. */
export async function atRiskForClock(slaClockId: string, now: string, tx: DbLike = db): Promise<boolean> {
  const action = await tx.query<{ id: string; status: string; depends_on_action_id: string | null }>(
    `SELECT id, status, depends_on_action_id FROM action WHERE sla_clock_id = $1`,
    [slaClockId]
  );
  const task = await tx.query<{
    id: string; status: string; task_code: string; stage_instance_id: string;
    forecast_end: string | Date; planned_end: string | Date;
  }>(
    `SELECT id, status, task_code, stage_instance_id, forecast_end, planned_end
       FROM task_instance WHERE sla_clock_id = $1`,
    [slaClockId]
  );

  const blocked = action.rows[0]?.status === "Blocked" || task.rows[0]?.status === "Blocked";

  let dependencyOverdue = false;
  if (action.rows[0]?.depends_on_action_id) {
    const dep = await tx.query<{ sla_clock_id: string | null }>(
      `SELECT sla_clock_id FROM action WHERE id = $1`,
      [action.rows[0].depends_on_action_id]
    );
    dependencyOverdue = await clockIsOverdue(dep.rows[0]?.sla_clock_id ?? null, now, tx);
  }
  if (!dependencyOverdue && task.rows[0]) {
    const journey = await tx.query<{ journey_id: string; template_version_id: string }>(
      `SELECT si.journey_id, ji.template_version_id
         FROM stage_instance si JOIN journey_instance ji ON ji.id = si.journey_id
        WHERE si.id = $1`,
      [task.rows[0].stage_instance_id]
    );
    if (journey.rows[0]) {
      const preds = await tx.query<{ sla_clock_id: string | null }>(
        `SELECT pred.sla_clock_id
           FROM journey_dependency jd
           JOIN task_instance pred ON pred.task_code = jd.from_task_code
           JOIN stage_instance psi ON psi.id = pred.stage_instance_id
          WHERE jd.version_id = $1 AND jd.to_task_code = $2 AND psi.journey_id = $3
            AND pred.status NOT IN ('Closed', 'Cancelled')`,
        [journey.rows[0].template_version_id, task.rows[0].task_code, journey.rows[0].journey_id]
      );
      for (const pred of preds.rows) {
        if (await clockIsOverdue(pred.sla_clock_id, now, tx)) {
          dependencyOverdue = true;
          break;
        }
      }
    }
  }

  return computeAtRisk({
    blocked,
    forecastEnd: task.rows[0]?.forecast_end ?? null,
    plannedEnd: task.rows[0]?.planned_end ?? null,
    dependencyOverdue,
  });
}
