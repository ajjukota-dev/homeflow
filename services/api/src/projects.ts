import { randomUUID } from "node:crypto";
import { db } from "./db";
import { getUnit } from "./handlers";
import { withTx, actorFields, type DbLike } from "./events";
import { defaultPortfolioId } from "./model/projects";
import { defaultHierarchyNodeId, insertUnit, type UnitInput } from "./model/units";
import { requireRole, SITE_SETUP_ROLES, STAFF_ROLES } from "./authz/requireRole";
import type { Ctx } from "./authz/types";

// Project/Site master-data creation. Project owns unit creation (data-model.md §2).
// New units seed a progress row per component (all not_started) so gates derive immediately.

export async function listProjects(ctx: Ctx) {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM project ORDER BY name`
  );
  return r.rows;
}

export async function createProject(input: { code: string; name: string }, ctx: Ctx) {
  requireRole(ctx, SITE_SETUP_ROLES);
  if (!input.code?.trim() || !input.name?.trim()) throw new Error("code and name required");
  const id = "p_" + randomUUID().slice(0, 8);
  const portfolioId = await defaultPortfolioId();
  await db.query(`INSERT INTO project (id, code, name, portfolio_id) VALUES ($1,$2,$3,$4)`, [
    id,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    portfolioId,
  ]);
  await cloneStandardPlan(id);
  return { id, code: input.code.trim().toUpperCase(), name: input.name.trim() };
}

/** Delegates to model/units.ts — kept here since it's the existing Sales/Site-facing entry
 *  point; a caller who doesn't supply a hierarchy node gets the project's default one. */
export async function createUnit(
  projectId: string,
  input: Omit<UnitInput, "product_type"> & { hierarchy_node_id?: string; product_type?: UnitInput["product_type"] },
  ctx: Ctx,
  tx?: DbLike
) {
  requireRole(ctx, SITE_SETUP_ROLES);
  const p = await db.query(`SELECT id FROM project WHERE id = $1`, [projectId]);
  if (p.rows.length === 0) throw new Error("project_not_found");

  const id = await withTx(tx, async (t) => {
    const hierarchyNodeId = input.hierarchy_node_id ?? (await defaultHierarchyNodeId(projectId, t));
    return insertUnit(t, projectId, hierarchyNodeId, input, actorFields(ctx));
  });
  return getUnit(id);
}

/** Copy the org-standard payment plan + collections policy onto a new project. */
async function cloneStandardPlan(projectId: string) {
  const tmpl = await db.query<{ id: string; name: string; basis: string }>(
    `SELECT id, name, basis FROM payment_plan WHERE project_id IS NULL LIMIT 1`
  );
  if (tmpl.rows.length === 0) return;
  const planId = "plan_" + randomUUID().slice(0, 8);
  await db.query(`INSERT INTO payment_plan (id, project_id, name, basis) VALUES ($1,$2,$3,$4)`, [
    planId,
    projectId,
    tmpl.rows[0].name,
    tmpl.rows[0].basis,
  ]);
  const ms = await db.query<{
    milestone_key: string;
    milestone_label: string;
    construction_trigger_event: string | null;
    sequence: number;
    pct_of_consideration: number;
  }>(
    `SELECT milestone_key, milestone_label, construction_trigger_event, sequence, pct_of_consideration::float8 AS pct_of_consideration
       FROM payment_plan_milestone WHERE plan_id = $1`,
    [tmpl.rows[0].id]
  );
  for (const m of ms.rows) {
    await db.query(
      `INSERT INTO payment_plan_milestone (id, plan_id, milestone_key, milestone_label, construction_trigger_event, sequence, pct_of_consideration)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        planId,
        m.milestone_key,
        m.milestone_label,
        m.construction_trigger_event,
        m.sequence,
        m.pct_of_consideration,
      ]
    );
  }
  const pol = await db.query<{ true_risk_max_probability: number; registration_min_pct: number }>(
    `SELECT true_risk_max_probability::float8 AS true_risk_max_probability,
            COALESCE(registration_min_pct, 0.70)::float8 AS registration_min_pct
       FROM collection_policy LIMIT 1`
  );
  await db.query(
    `INSERT INTO collection_policy (project_id, true_risk_max_probability, registration_min_pct) VALUES ($1,$2,$3)`,
    [projectId, pol.rows[0]?.true_risk_max_probability ?? 0.4, pol.rows[0]?.registration_min_pct ?? 0.7]
  );
  const hp = await db.query<{
    readiness_threshold: number;
    minor_snag_max: number;
    dlp_months: number;
    checkin_days: string;
  }>(
    `SELECT readiness_threshold::float8 AS readiness_threshold, minor_snag_max, dlp_months, checkin_days
       FROM handover_policy LIMIT 1`
  );
  await db.query(
    `INSERT INTO handover_policy (project_id, readiness_threshold, minor_snag_max, dlp_months, checkin_days)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      projectId,
      hp.rows[0]?.readiness_threshold ?? 80,
      hp.rows[0]?.minor_snag_max ?? 2,
      hp.rows[0]?.dlp_months ?? 12,
      hp.rows[0]?.checkin_days ?? "7,30,90",
    ]
  );
}
