// 27-management-control-tower.md rule 4 — KPI snapshots (compute-on-read, persisted for trend,
// same pattern 14's score_snapshot and 20's forecast_snapshot already established) and drill.

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { withTx, appendEvent, actorFields } from "../events";
import { authorize } from "../authz/authorize";
import type { Ctx } from "../authz/types";
import { computeKpi } from "../kpis/queries";

export interface KpiDefinitionRow {
  code: string; domain: string; name: string; formula_ref: string; unit: string; direction: string; target: number | null;
}
export interface KpiView extends KpiDefinitionRow {
  value: number | null; numerator: number; denominator: number; period: string; trend: number | null; // this period's value minus prior period's
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

async function loadDefinitions(domain?: string): Promise<KpiDefinitionRow[]> {
  const r = domain
    ? await db.query<KpiDefinitionRow>(`SELECT code, domain, name, formula_ref, unit, direction, target::float8 AS target FROM kpi_definition WHERE domain = $1 ORDER BY code`, [domain])
    : await db.query<KpiDefinitionRow>(`SELECT code, domain, name, formula_ref, unit, direction, target::float8 AS target FROM kpi_definition ORDER BY domain, code`);
  return r.rows;
}

/** GET /kpis?project_id&period&domain — computes live, snapshots (upsert per period), returns
 *  with trend vs the prior calendar month's stored snapshot (rule 4's "trend vs prior period"). */
export async function getKpis(projectId: string, ctx: Ctx, domain?: string, period = currentPeriod()): Promise<KpiView[]> {
  await authorize(ctx, "reports", "READ");
  const defs = await loadDefinitions(domain);
  const priorPeriod = new Date(period + "-01T00:00:00Z");
  priorPeriod.setUTCMonth(priorPeriod.getUTCMonth() - 1);
  const priorKey = priorPeriod.toISOString().slice(0, 7);

  const out: KpiView[] = [];
  let changed = false;
  for (const def of defs) {
    const result = await computeKpi(def.formula_ref, projectId, period, db);
    const existing = await db.query<{ value: number | null }>(
      `SELECT value::float8 AS value FROM kpi_snapshot WHERE kpi_code = $1 AND project_id = $2 AND period = $3`,
      [def.code, projectId, period]
    );
    // Only record kpi.snapshot_taken when this GET actually moved a value — a compute-on-read
    // that reruns the same formula on unchanged data must not append forever (the append-only
    // event log makes every unconditional write permanent).
    if (!existing.rows[0] || existing.rows[0].value !== result.value) changed = true;
    await withTx(undefined, async (tx) => {
      await tx.query(
        `INSERT INTO kpi_snapshot (id, kpi_code, project_id, period, value, numerator, denominator)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (kpi_code, COALESCE(project_id, ''), period) DO UPDATE SET value = $5, numerator = $6, denominator = $7, computed_at = now()`,
        [randomUUID(), def.code, projectId, period, result.value, result.numerator, result.denominator]
      );
    });
    const prior = await db.query<{ value: number }>(
      `SELECT value::float8 AS value FROM kpi_snapshot WHERE kpi_code = $1 AND project_id = $2 AND period = $3`,
      [def.code, projectId, priorKey]
    );
    out.push({
      ...def,
      value: result.value,
      numerator: result.numerator,
      denominator: result.denominator,
      period,
      trend: result.value !== null && prior.rows[0]?.value !== undefined ? result.value - prior.rows[0].value : null,
    });
  }
  if (changed) {
    await appendEvent(db, { type: "kpi.snapshot_taken", entity_type: "project", entity_id: projectId, project_id: projectId, payload: { period, count: out.length }, ...actorFields(ctx) });
  }
  return out;
}

/** GET /kpis/:code/drill?project_id&period — the underlying facts behind one KPI's value, plus
 *  its snapshot history (rule 4's "each numbers links to the underlying list"). */
export async function drillKpi(code: string, projectId: string, ctx: Ctx, period = currentPeriod()) {
  await authorize(ctx, "reports", "READ");
  const def = (await db.query<KpiDefinitionRow>(`SELECT code, domain, name, formula_ref, unit, direction, target::float8 AS target FROM kpi_definition WHERE code = $1`, [code])).rows[0];
  if (!def) throw new Error("not_found");
  const current = await computeKpi(def.formula_ref, projectId, period, db);
  const history = await db.query<{ period: string; value: number }>(
    `SELECT period, value::float8 AS value FROM kpi_snapshot WHERE kpi_code = $1 AND project_id = $2 ORDER BY period`,
    [code, projectId]
  );
  return { ...def, current, history: history.rows };
}
