import { randomUUID } from "node:crypto";
import { query } from "../db";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { appendAuthEvent } from "./events";

export interface AssignmentInput {
  project_id: string;
  user_id: string;
  department: string;
  role_scope: string;
  team_id?: string | null;
  assignment_type?: "DEDICATED" | "SHARED" | "CENTRAL";
  is_primary_owner?: boolean;
  is_backup_owner?: boolean;
  effective_from: string;
  effective_to?: string | null;
  capacity_pct?: number;
  escalation_manager_user_id?: string | null;
}

/** POST /admin/assignments — Teams & Assignments (p36 §31.1). */
export async function createAssignment(input: AssignmentInput, ctx: Ctx): Promise<{ id: string }> {
  await authorize(ctx, "administration", "WRITE");
  if (!input.project_id || !input.user_id || !input.department || !input.effective_from) {
    throw new AppError("validation", "project_id, user_id, department and effective_from are required");
  }
  const id = randomUUID();
  await query(
    `INSERT INTO project_team_assignment
       (id, project_id, team_id, user_id, department, role_scope, assignment_type, is_primary_owner, is_backup_owner,
        effective_from, effective_to, capacity_pct, escalation_manager_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      input.project_id,
      input.team_id ?? null,
      input.user_id,
      input.department,
      input.role_scope ?? input.department,
      input.assignment_type ?? "DEDICATED",
      input.is_primary_owner ?? false,
      input.is_backup_owner ?? false,
      input.effective_from,
      input.effective_to ?? null,
      input.capacity_pct ?? 100,
      input.escalation_manager_user_id ?? null,
    ]
  );
  await appendAuthEvent("access.assignment_changed", ctx.actor.user_id, input.user_id, { id, action: "created" });
  return { id };
}

/** PATCH /admin/assignments/:id — Rule 8: effective-dated, never rewrites history. */
export async function updateAssignment(id: string, input: Partial<AssignmentInput>, ctx: Ctx): Promise<void> {
  await authorize(ctx, "administration", "WRITE");
  if (input.effective_to !== undefined) {
    await query(`UPDATE project_team_assignment SET effective_to = $1 WHERE id = $2`, [input.effective_to, id]);
  }
  if (input.is_primary_owner !== undefined) {
    await query(`UPDATE project_team_assignment SET is_primary_owner = $1 WHERE id = $2`, [input.is_primary_owner, id]);
  }
  if (input.is_backup_owner !== undefined) {
    await query(`UPDATE project_team_assignment SET is_backup_owner = $1 WHERE id = $2`, [input.is_backup_owner, id]);
  }
  if (input.capacity_pct !== undefined) {
    await query(`UPDATE project_team_assignment SET capacity_pct = $1 WHERE id = $2`, [input.capacity_pct, id]);
  }
  await appendAuthEvent("access.assignment_changed", ctx.actor.user_id, null, { id, action: "updated" });
}

export interface AssignmentRow extends AssignmentInput {
  id: string;
}

/** GET-adjacent helper for the Teams & Assignments admin screen. */
export async function listAssignments(ctx: Ctx, projectId?: string): Promise<AssignmentRow[]> {
  await authorize(ctx, "administration", "WRITE");
  const r = await query<AssignmentRow>(
    `SELECT id, project_id, team_id, user_id, department, role_scope, assignment_type, is_primary_owner,
            is_backup_owner, effective_from, effective_to, capacity_pct, escalation_manager_user_id
       FROM project_team_assignment
      ${projectId ? "WHERE project_id = $1" : ""}
      ORDER BY effective_from DESC`,
    projectId ? [projectId] : []
  );
  return r.rows;
}
