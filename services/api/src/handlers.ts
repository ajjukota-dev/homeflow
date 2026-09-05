import { db } from "./db";
import type { ProgressState } from "./gates";
import type { DbLike } from "./events";
import { requireRole, STAFF_ROLES } from "./authz/requireRole";
import type { Ctx } from "./authz/types";
import { loadGateCategories, loadGateRules, loadProgressMap, gatesFromProgress } from "./progress/gate-inputs";
import { updateProgress } from "./progress/core";

// Pure-ish handlers (portable to Lambda). Each reads/writes the DB and derives gates. The gate
// input loaders moved to progress/gate-inputs.ts when 07 needed them for dry-run previews.

async function gatesForUnit(unitId: string) {
  const [cats, rls, progress] = await Promise.all([loadGateCategories(), loadGateRules(), loadProgressMap(unitId)]);
  return gatesFromProgress(progress, cats, rls);
}

/** Sales inventory — every available unit with live gates + score (optionally by project).
 *  Pre-booking master data, not in the customer-file permission_matrix — role-gated (R0.6). */
export async function listUnits(projectId: string | undefined, ctx: Ctx) {
  requireRole(ctx, STAFF_ROLES);
  const units = await db.query<{
    id: string;
    unit_number: string;
    unit_type: string;
    facing: string;
    sale_status: string;
  }>(
    `SELECT id, unit_number, unit_type, facing, sale_status FROM unit
     ${projectId ? "WHERE project_id = $1" : ""} ORDER BY unit_number`,
    projectId ? [projectId] : []
  );
  const out = [];
  for (const u of units.rows) {
    const { gates, score } = await gatesForUnit(u.id);
    out.push({ ...u, score, gates });
  }
  return out;
}

/** Project/Site — one unit with its component progress + resulting gates. `ctx` is only
 *  supplied at the route entry point (GET /api/units/:id); internal reentrant callers
 *  (createUnit, setProgress returning the fresh state) skip it — the caller already
 *  authorized before reaching here, so this isn't a separate attack surface. */
export async function getUnit(unitId: string, ctx?: Ctx) {
  if (ctx) requireRole(ctx, STAFF_ROLES);
  const u = await db.query<{
    id: string;
    unit_number: string;
    unit_type: string;
    facing: string;
    sale_status: string;
  }>(`SELECT id, unit_number, unit_type, facing, sale_status FROM unit WHERE id=$1`, [unitId]);
  if (u.rows.length === 0) return null;
  const comps = await db.query<{ code: string; label: string; state_code: string }>(
    `SELECT c.code, c.label, p.state_code
       FROM component_definition c
       JOIN unit_progress p ON p.component_code=c.code AND p.unit_id=$1
       ORDER BY c.sort_order`,
    [unitId]
  );
  const { gates, score } = await gatesForUnit(unitId);
  return { ...u.rows[0], score, components: comps.rows, gates };
}

/** Project/Site writes progress → gates re-derive (the H1 loop). Kept as the compatible entry
 *  point for the original `PUT /api/units/:id/progress` route and its callers; the real write
 *  (rules 1–4, 7, 8 of 07, plus the milestone-demand chain) lives in progress/core.ts. */
export async function setProgress(
  unitId: string,
  component: string,
  state: ProgressState,
  ctx: Ctx,
  tx?: DbLike
) {
  await updateProgress(unitId, component, { state_code: state }, ctx, { tx });
  return getUnit(unitId);
}
