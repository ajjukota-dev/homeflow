import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, POLICY_STUDIO_ROLES, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { requireJourney } from "./instances";
import { asDateStr } from "./calendar";

// 06-timeline-sla-engine.md rule 2 + rule 8 (p46 §34.6, t8 "Delay reason is mandatory when a
// planned date moves"): a timeline_plan_revision row is the only way planned_start/planned_end
// on stage_instance ever change post-instantiation. Gated the same as closeJourney
// (POLICY_STUDIO_ROLES) — a plan revision rewrites the schedule management reports against,
// the same class of consequential change as closing a journey, not a routine hold/resume.

export interface PlanRevisionChange {
  stage_code: string;
  new_planned_start: string; // YYYY-MM-DD
  new_planned_end: string;
}

export interface PlanRevisionInput {
  changes: PlanRevisionChange[];
  reason_code: string;
  note?: string | null;
}

export interface PlanRevisionRow {
  id: string;
  journey_id: string;
  revised_at: string;
  revised_by: string | null;
  reason_code: string;
  note: string | null;
  changes: { stage_code: string; old_planned_start: string; old_planned_end: string; new_planned_start: string; new_planned_end: string }[];
}

async function requireDelayReason(code: string, tx: DbLike): Promise<void> {
  const r = await tx.query(`SELECT code FROM delay_reason WHERE code = $1`, [code]);
  if (!r.rows[0]) throw new AppError("validation", `unknown delay reason code: ${code}`, "reason_code");
}

/** Moves one or more stages' planned dates on a single journey, in one transaction, logging a
 *  full old/new diff (rule 2's "changes jsonb" column) so `listPlanRevisions` can render history.
 *  Baseline dates are never touched (rule 2: "they never change"). */
export async function createPlanRevision(journeyId: string, input: PlanRevisionInput, ctx: Ctx): Promise<PlanRevisionRow> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  if (!input.changes?.length) throw new AppError("validation", "at least one stage change is required", "changes");
  if (!input.reason_code?.trim()) throw new AppError("validation", "reason_code is required", "reason_code");
  for (const c of input.changes) {
    if (!c.stage_code?.trim()) throw new AppError("validation", "stage_code is required for every change", "changes");
    if (!c.new_planned_start || !c.new_planned_end) throw new AppError("validation", "new_planned_start and new_planned_end are required", "changes");
    if (new Date(c.new_planned_end) < new Date(c.new_planned_start)) {
      throw new AppError("validation", `${c.stage_code}: planned_end can't be before planned_start`, "changes");
    }
  }

  const id = "tpr_" + randomUUID().slice(0, 8);
  const diff: PlanRevisionRow["changes"] = [];

  await withTx(undefined, async (tx) => {
    const j = await requireJourney(journeyId, tx);
    await requireDelayReason(input.reason_code, tx);

    for (const c of input.changes) {
      const existing = await tx.query<{ id: string; planned_start: string | Date; planned_end: string | Date }>(
        `SELECT id, planned_start, planned_end FROM stage_instance WHERE journey_id = $1 AND stage_code = $2`,
        [journeyId, c.stage_code]
      );
      if (!existing.rows[0]) throw new AppError("not_found", `no stage ${c.stage_code} on this journey`);
      const old = existing.rows[0];
      await tx.query(
        `UPDATE stage_instance SET planned_start = $1, planned_end = $2 WHERE id = $3`,
        [c.new_planned_start, c.new_planned_end, old.id]
      );
      diff.push({
        stage_code: c.stage_code,
        old_planned_start: asDateStr(old.planned_start),
        old_planned_end: asDateStr(old.planned_end),
        new_planned_start: c.new_planned_start,
        new_planned_end: c.new_planned_end,
      });
    }

    await tx.query(
      `INSERT INTO timeline_plan_revision (id, journey_id, revised_by, reason_code, note, changes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [id, journeyId, ctx.actor.user_id, input.reason_code, input.note ?? null, JSON.stringify(diff)]
    );
    await appendEvent(tx, {
      type: "plan.revised",
      entity_type: "journey_instance",
      entity_id: journeyId,
      project_id: j.project_id,
      payload: { reason_code: input.reason_code, changes: diff },
      ...actorFields(ctx),
    });
  });

  const row = await db.query<{ revised_at: string }>(`SELECT revised_at FROM timeline_plan_revision WHERE id = $1`, [id]);
  return {
    id,
    journey_id: journeyId,
    revised_at: row.rows[0].revised_at,
    revised_by: ctx.actor.user_id,
    reason_code: input.reason_code,
    note: input.note ?? null,
    changes: diff,
  };
}

export async function listPlanRevisions(journeyId: string, ctx: Ctx): Promise<PlanRevisionRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<PlanRevisionRow>(
    `SELECT id, journey_id, revised_at, revised_by, reason_code, note, changes
       FROM timeline_plan_revision WHERE journey_id = $1 ORDER BY revised_at DESC`,
    [journeyId]
  );
  return r.rows;
}
