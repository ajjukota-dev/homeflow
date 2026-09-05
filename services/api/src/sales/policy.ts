import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { DbLike } from "../events";
import { requireRole, POLICY_STUDIO_ROLES, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import type { MatchPolicy } from "./match";

// 24 config (Policy Studio "hold policy", "filter thresholds", "match weights"). A project row
// overrides the standard (NULL project) row; the code defaults below apply when neither exists,
// so the engine never blocks on missing config — every number here is UNCONFIRMED.

export interface SalesPolicy extends MatchPolicy {
  id: string | null;
  project_id: string | null;
  highly_customisable_min: number;
  closing_soon_days: number;
  match_stale_hours: number;
  filter_categories: Record<string, string>;
}

export const DEFAULT_SALES_POLICY: SalesPolicy = {
  id: null,
  project_id: null,
  highly_customisable_min: 70,
  closing_soon_days: 14,
  match_stale_hours: 24,
  match_weights: { MUST_HAVE: 3, PREFERRED: 1, NOT_IMPORTANT: 0 },
  state_values: { OPEN: 1, CLOSING: 0.75, CONDITIONAL: 0.5, EXCEPTION_ONLY: 0.1, HARD_CLOSED: 0 },
  must_have_hard_closed_cap: 40,
  filter_categories: { layout_flexible: "structural", kitchen_open: "kitchen_layout", electrical_open: "electrical", flooring_open: "flooring_selection" },
};

export async function loadSalesPolicy(projectId: string, tx: DbLike = db): Promise<SalesPolicy> {
  const r = await tx.query<SalesPolicy>(
    `SELECT id, project_id, highly_customisable_min, closing_soon_days, match_stale_hours, match_weights, state_values, must_have_hard_closed_cap, filter_categories
       FROM sales_policy WHERE project_id = $1 OR project_id IS NULL ORDER BY (project_id IS NULL) ASC LIMIT 1`,
    [projectId]
  );
  return r.rows[0] ?? DEFAULT_SALES_POLICY;
}

export interface HoldPolicy {
  id: string | null;
  project_id: string | null;
  max_days: number;
  max_active_per_project: number;
  allowed_categories: string[] | null;
  approver_role: string;
  auto_expire: boolean;
}

// p14 "Project-approved": the Projects department is the SITE role in the seeded role list.
export const DEFAULT_HOLD_POLICY: HoldPolicy = { id: null, project_id: null, max_days: 14, max_active_per_project: 5, allowed_categories: null, approver_role: "SITE", auto_expire: true };

export async function loadHoldPolicy(projectId: string, tx: DbLike = db): Promise<HoldPolicy> {
  const r = await tx.query<HoldPolicy>(
    `SELECT id, project_id, max_days, max_active_per_project, allowed_categories, approver_role, auto_expire
       FROM hold_policy WHERE project_id = $1 OR project_id IS NULL ORDER BY (project_id IS NULL) ASC LIMIT 1`,
    [projectId]
  );
  return r.rows[0] ?? DEFAULT_HOLD_POLICY;
}

export async function getHoldPolicy(projectId: string | null, ctx: Ctx): Promise<HoldPolicy> {
  requireRole(ctx, STAFF_ROLES);
  return loadHoldPolicy(projectId ?? "", db);
}

export async function putHoldPolicy(input: Partial<HoldPolicy> & { project_id?: string | null }, ctx: Ctx): Promise<HoldPolicy> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  const projectId = input.project_id ?? null;
  const base = { ...DEFAULT_HOLD_POLICY, ...input };
  if (base.max_days <= 0 || base.max_active_per_project <= 0) throw new AppError("validation", "max_days and max_active_per_project must be positive");
  const existing = await db.query<{ id: string }>(`SELECT id FROM hold_policy WHERE COALESCE(project_id, '') = COALESCE($1, '')`, [projectId]);
  const id = existing.rows[0]?.id ?? "hp_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO hold_policy (id, project_id, max_days, max_active_per_project, allowed_categories, approver_role, auto_expire)
     VALUES ($1,$2,$3,$4,$5::text[],$6,$7)
     ON CONFLICT (id) DO UPDATE SET max_days = $3, max_active_per_project = $4, allowed_categories = $5::text[], approver_role = $6, auto_expire = $7`,
    [id, projectId, base.max_days, base.max_active_per_project, base.allowed_categories, base.approver_role, base.auto_expire]
  );
  return (await db.query<HoldPolicy>(`SELECT id, project_id, max_days, max_active_per_project, allowed_categories, approver_role, auto_expire FROM hold_policy WHERE id = $1`, [id])).rows[0]!;
}
