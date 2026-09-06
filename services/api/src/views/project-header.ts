// 28-360-views.md rule 4 — the sticky Project 360 header. No dedicated `permission_matrix` module
// covers a cross-cutting composition read like this (same documented gap class as 20's forecast
// and 25's Policy Studio routes) — gated with `requireRole(STAFF_ROLES)`, same as `getUnit`.

import { db } from "../db";
import { requireRole, STAFF_ROLES, FORECAST_READ_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { projectCollections } from "../collections-view";
import { listEscalations } from "../escalations/core";
import { getForecast } from "../forecast/core";
import { today } from "../demands";
import { explainUnitReadiness } from "../scores/unit-readiness";

export interface ProjectHeaderView {
  project_id: string;
  code: string;
  name: string;
  product_mix: { product_type: string; sale_status: string; count: number }[];
  units_sold: number;
  units_available: number;
  units_total: number;
  true_risk_inr: number;
  open_material_escalations: number;
  unit_readiness_avg: number | null;
  next_month_forecast_inr: number | null; // null for a viewer without forecast read access
  actual_to_date_inr: number | null;
  handovers_due_30d: null; // flagged below — no real data source exists for this yet
  handovers_due_30d_reason: string;
}

/** GET /projects/:id/header. Rule 4's "handovers due 30 d (16)" has no real data source: 06 carries
 *  no independent handover-stage forecast date (already flagged at 27's landing, `h_on_time_pct`'s
 *  own comment) — returned as a named gap, not guessed. */
export async function getProjectHeader(projectId: string, ctx: Ctx): Promise<ProjectHeaderView> {
  requireRole(ctx, STAFF_ROLES);
  const project = await db.query<{ code: string; name: string }>(`SELECT code, name FROM project WHERE id = $1`, [projectId]);
  if (!project.rows[0]) throw new AppError("not_found", "not_found");

  const mix = await db.query<{ product_type: string; sale_status: string; count: string }>(
    `SELECT product_type, sale_status, count(*) AS count FROM unit WHERE project_id = $1 GROUP BY product_type, sale_status ORDER BY product_type, sale_status`,
    [projectId]
  );
  const product_mix = mix.rows.map((r) => ({ product_type: r.product_type, sale_status: r.sale_status, count: Number(r.count) }));
  const units_sold = product_mix.filter((r) => r.sale_status !== "available").reduce((s, r) => s + r.count, 0);
  const units_available = product_mix.filter((r) => r.sale_status === "available").reduce((s, r) => s + r.count, 0);

  const collections = await projectCollections(projectId);
  const escalations = await listEscalations({ project_id: projectId, status: "OPEN" }, ctx);

  // Unit Readiness average — `explainUnitReadiness` (not `computeUnitReadiness`) computes the
  // same live value via the same `build()`/`previousValue()` but has no `persistSnapshot` call.
  // This header sits on every module screen (rule 4); `computeUnitReadiness` unconditionally
  // INSERTs a score_snapshot row per call, so N of them per load would mean N unwanted writes on
  // the hottest path in the app — the write-on-read class advisor flagged at 27's landing, avoided
  // here rather than noted away. N× read cost (one live compute per unit) is unchanged from that
  // shape and is the same already-documented cost as 27's `getPortfolio` — not a new concern.
  const units = await db.query<{ id: string }>(`SELECT id FROM unit WHERE project_id = $1`, [projectId]);
  const readiness = await Promise.all(units.rows.map((u) => explainUnitReadiness(u.id)));
  const unit_readiness_avg = readiness.length > 0 ? readiness.reduce((s, r) => s + r.value, 0) / readiness.length : null;

  // Forecast (20) is gated to ACCOUNTS/BANKING/MANAGEMENT/SUPER_ADMIN (no shared "reports" module
  // covers it — same gap 20's own Build note already documents) — a SALES/SITE/QA viewer of this
  // header simply doesn't get these two figures, rather than the whole header 403ing on them.
  let next_month_forecast_inr: number | null = null;
  let actual_to_date_inr: number | null = null;
  if (FORECAST_READ_ROLES.some((r) => ctx.actor.roles.includes(r))) {
    const now = today();
    const nextMonth = new Date(now + "T00:00:00Z");
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const nextPeriod = nextMonth.toISOString().slice(0, 7);
    const forecast = await getForecast(projectId, { from: nextPeriod, to: nextPeriod, lane: "COMMITTED" }, ctx);
    next_month_forecast_inr = forecast.periods[0]?.expected_weighted ?? 0;
    const actual = await db.query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM receipt WHERE project_id = $1 AND received_at >= date_trunc('month', now())`,
      [projectId]
    );
    actual_to_date_inr = actual.rows[0]?.total ?? 0;
  }

  return {
    project_id: projectId,
    code: project.rows[0].code,
    name: project.rows[0].name,
    product_mix,
    units_sold,
    units_available,
    units_total: units_sold + units_available,
    true_risk_inr: collections.buckets.TRUE_RISK.amount,
    open_material_escalations: escalations.length,
    unit_readiness_avg,
    next_month_forecast_inr,
    actual_to_date_inr,
    handovers_due_30d: null,
    handovers_due_30d_reason: "no handover-stage forecast date exists anywhere (06's own documented gap)",
  };
}
