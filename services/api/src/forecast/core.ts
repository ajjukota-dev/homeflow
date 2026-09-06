// 20-cash-forecast.md orchestration: read-time derive (rule 1/7), waterfall (rule 4), scenarios
// (rule 5), snapshots + compare (rule 3/6), manual override (rule 1). No permission_matrix module
// exists for this domain — see authz/requireRole.ts's FORECAST_READ_ROLES/FORECAST_WRITE_ROLES
// header for why role-gating is used directly instead, same gap class R0.6 already found for
// pre-matrix routes.

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, FORECAST_READ_ROLES, FORECAST_WRITE_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { today } from "../demands";
import {
  deriveProjectLines,
  applyScenarioAssumptions,
  futureSalesLines,
  type DerivedLine,
  type ScenarioAssumptions,
} from "./derive";
import { computeWaterfall, type WaterfallPeriodResult, type WaterfallLine } from "./waterfall";
import { computeProbability } from "./probability";

export interface ForecastLineRow {
  id: string;
  project_id: string;
  booking_id: string;
  demand_id: string | null;
  loan_case_id: string | null;
  source_type: string;
  lane: "COMMITTED" | "SCENARIO";
  scenario_id: string | null;
  expected_date: string;
  amount_inr: number;
  probability: number;
  probability_drivers: { label: string; value: string }[];
  period: string;
  status: string;
}

const LINE_SELECT = `
  SELECT id, project_id, booking_id, demand_id, loan_case_id, source_type, lane, scenario_id,
         expected_date::text AS expected_date, amount_inr::float8 AS amount_inr, probability::float8 AS probability,
         probability_drivers, period, status
    FROM forecast_line
`;

async function mapLines(sql: string, params: unknown[], handle: DbLike = db): Promise<ForecastLineRow[]> {
  const r = await handle.query<ForecastLineRow>(sql, params);
  return r.rows;
}

function assumptionsFromRows(rows: { key: string; value: number }[]): ScenarioAssumptions {
  const a: ScenarioAssumptions = {};
  for (const r of rows) {
    if (r.key === "COLLECTION_EFFICIENCY_PCT") a.collection_efficiency_pct = r.value;
    else if (r.key === "LOAN_DISBURSEMENT_LAG_DAYS") a.loan_disbursement_lag_days = r.value;
    else if (r.key === "FUTURE_SALES_PER_MONTH") a.future_sales_per_month = r.value;
    else if (r.key === "FUTURE_SALE_TICKET_INR") a.future_sale_ticket_inr = r.value;
    else if (r.key === "CONSTRUCTION_SLIP_DAYS") a.construction_slip_days = r.value;
    else if (r.key === "PTP_HONOUR_PCT") a.ptp_honour_pct = r.value;
  }
  return a;
}

async function ensureBaselineScenario(projectId: string, tx: DbLike = db): Promise<string> {
  const existing = await tx.query<{ id: string }>(`SELECT id FROM forecast_scenario WHERE project_id = $1 AND code = 'BASE'`, [projectId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = "fs_" + randomUUID().slice(0, 8);
  await tx.query(`INSERT INTO forecast_scenario (id, project_id, code, is_baseline) VALUES ($1,$2,'BASE',true)`, [id, projectId]);
  return id;
}

export interface ForecastQuery {
  scenario?: string; // code, e.g. "BASE" | "CONSERVATIVE" | "STRETCH" | custom
  from?: string; // YYYY-MM
  to?: string; // YYYY-MM
  lane?: "COMMITTED" | "SCENARIO";
}

export interface ForecastView {
  lines: ForecastLineRow[];
  periods: WaterfallPeriodResult[];
  scenario: { id: string; code: string; is_baseline: boolean };
  lane: "COMMITTED" | "SCENARIO";
}

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function defaultRange(asOf: string): { from: string; to: string } {
  const from = asOf.slice(0, 7);
  const [y, m] = from.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + 3, 1)); // rule 6: 30/60/90-day forward ~ 3 months
  return { from, to: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}` };
}

/** Unauthorized core builder — used by the authorized `getForecast` (routes), `takeSnapshot`
 *  and `compareForecast`. Reads whatever forecast_line rows currently exist; does NOT re-derive
 *  (see `getForecast` for why) — never exported directly. */
async function buildForecastView(projectId: string, query: ForecastQuery, ctx?: Ctx): Promise<ForecastView> {
  const asOf = today();
  const { from, to } = { from: query.from ?? defaultRange(asOf).from, to: query.to ?? defaultRange(asOf).to };
  const lane = query.lane ?? "COMMITTED";
  const scenarioCode = query.scenario ?? "BASE";

  const scenarioRow = await db.query<{ id: string; code: string; is_baseline: boolean }>(
    `SELECT id, code, is_baseline FROM forecast_scenario WHERE project_id = $1 AND code = $2`,
    [projectId, scenarioCode]
  );
  const scenario = scenarioRow.rows[0] ?? { id: await ensureBaselineScenario(projectId), code: "BASE", is_baseline: true };

  const committed = await mapLines(`${LINE_SELECT} WHERE project_id = $1 AND lane = 'COMMITTED' AND status IN ('ACTIVE','REALISED') AND period BETWEEN $2 AND $3 ORDER BY expected_date`, [projectId, from, to]);

  let lines: ForecastLineRow[] = committed;
  if (lane === "SCENARIO") {
    if (scenario.is_baseline) throw new AppError("validation", "BASE is the committed baseline — pass a CONSERVATIVE/STRETCH/custom scenario code for the scenario lane", "scenario");
    const assumptionRows = await db.query<{ key: string; value: number }>(`SELECT key, value::float8 AS value FROM forecast_assumption WHERE scenario_id = $1`, [scenario.id]);
    const assumptions = assumptionsFromRows(assumptionRows.rows);
    const transformed = applyScenarioAssumptions(
      committed.map((l): DerivedLine => ({ demand_id: l.demand_id, loan_case_id: l.loan_case_id, source_type: l.source_type as DerivedLine["source_type"], expected_date: l.expected_date, amount_inr: l.amount_inr, probability: l.probability, probability_drivers: l.probability_drivers })),
      assumptions
    );
    const future = futureSalesLines(assumptions, asOf, monthRange(from, to).length).filter((l) => l.expected_date.slice(0, 7) >= from && l.expected_date.slice(0, 7) <= to);
    lines = [...transformed, ...future].map((l, i) => ({
      id: `scenario_${i}`,
      project_id: projectId,
      booking_id: committed[i]?.booking_id ?? "",
      demand_id: l.demand_id,
      loan_case_id: l.loan_case_id,
      source_type: l.source_type,
      lane: "SCENARIO",
      scenario_id: scenario.id,
      expected_date: l.expected_date,
      amount_inr: l.amount_inr,
      probability: l.probability,
      probability_drivers: l.probability_drivers,
      period: l.expected_date.slice(0, 7),
      status: "ACTIVE",
    }));
  }

  const outstandingRow = await db.query<{ outstanding: number }>(
    `SELECT COALESCE(SUM(
       d.amount - COALESCE((SELECT SUM(r.amount) FROM receipt r WHERE r.demand_id = d.id AND r.status IN ('posted','reconciled') AND r.verification != 'DISPUTED'), 0)
                - COALESCE((SELECT SUM(w.amount) FROM waiver w WHERE w.demand_id = d.id AND w.status = 'APPROVED'), 0)
     ), 0)::float8 AS outstanding
     FROM demand d WHERE d.project_id = $1 AND d.status NOT IN ('settled', 'waived')`,
    [projectId]
  );

  const targets = await db.query<{ period: string; target_inr: number }>(`SELECT period, target_inr::float8 AS target_inr FROM cash_target WHERE project_id = $1`, [projectId]);
  const targetByPeriod = new Map(targets.rows.map((r) => [r.period, r.target_inr]));

  const periods = monthRange(from, to).map((period) => ({
    period,
    lines: lines.filter((l) => l.period === period).map((l): WaterfallLine => ({ source_type: l.source_type as WaterfallLine["source_type"], amount_inr: l.amount_inr, probability: l.probability })),
    target_inr: targetByPeriod.get(period) ?? null,
  }));

  const waterfall = computeWaterfall({ opening_outstanding: outstandingRow.rows[0]?.outstanding ?? 0, periods });
  return { lines, periods: waterfall, scenario, lane };
}

/** GET /projects/:id/forecast — rule 1 (derive fresh, compute-on-read, no scheduler exists —
 *  same precedent as 06/19/21/12/14) + rule 4 (waterfall) + rule 5 (scenario lane, never mutates
 *  COMMITTED/BASE). Lane is a required discriminator on the response, never silently defaulted to
 *  a summed view — rule 5/t8 "committed and scenario lanes are never mixed".
 *
 *  The one caller that scans every demand in the project (advisor-flagged): derive here only,
 *  not inside `buildForecastView`, so `compareForecast`/`takeSnapshot`/`portfolioCompare` read
 *  whatever's already current instead of each re-running the full per-demand derive pass — a
 *  portfolio compare over N projects would otherwise cost N derive passes instead of 0. */
export async function getForecast(projectId: string, query: ForecastQuery, ctx: Ctx): Promise<ForecastView> {
  requireRole(ctx, FORECAST_READ_ROLES);
  await deriveProjectLines(projectId, today(), db, ctx);
  return buildForecastView(projectId, query, ctx);
}

/** POST /forecast-lines/:id/override — rule 1: MANUAL_FINANCE_OVERRIDE requires Accounts lead +
 *  reason, supersedes the derived line for that demand. The next `deriveProjectLines` pass leaves
 *  this demand alone entirely (see derive.ts's `overriddenDemandIds` exclusion) until this row
 *  itself is no longer ACTIVE. */
export async function overrideForecastLine(
  lineId: string,
  input: { expected_date: string; amount_inr: number; probability: number; reason: string },
  ctx: Ctx
): Promise<ForecastLineRow> {
  requireRole(ctx, FORECAST_WRITE_ROLES);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  if (input.probability < 0 || input.probability > 1) throw new AppError("validation", "probability must be between 0 and 1", "probability");

  const existing = await mapLines(`${LINE_SELECT} WHERE id = $1`, [lineId]);
  if (!existing[0]) throw new AppError("not_found", "forecast line not found");
  const line = existing[0];
  if (line.lane !== "COMMITTED") throw new AppError("validation", "only committed-lane lines can be overridden", "lane");

  const newId = "fl_" + randomUUID().slice(0, 8);
  const { probability } = computeProbability({ source_type: "MANUAL_FINANCE_OVERRIDE", manualOverride: { probability: input.probability } });
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE forecast_line SET status = 'SUPERSEDED' WHERE id = $1`, [lineId]);
    await tx.query(
      `INSERT INTO forecast_line (id, project_id, booking_id, demand_id, loan_case_id, source_type, lane, expected_date, amount_inr, probability, probability_drivers, period, status, override_by, override_at, override_reason)
       VALUES ($1,$2,$3,$4,$5,'MANUAL_FINANCE_OVERRIDE','COMMITTED',$6,$7,$8,$9::jsonb,$10,'ACTIVE',$11,now(),$12)`,
      [newId, line.project_id, line.booking_id, line.demand_id, line.loan_case_id, input.expected_date, input.amount_inr, probability, JSON.stringify([{ label: "reason", value: input.reason }]), input.expected_date.slice(0, 7), ctx.actor.user_id, input.reason]
    );
    await appendEvent(tx, {
      type: "forecast.override_recorded",
      entity_type: "forecast_line",
      entity_id: newId,
      project_id: line.project_id,
      booking_id: line.booking_id,
      payload: { demand_id: line.demand_id, amount_inr: input.amount_inr, reason: input.reason },
      ...actorFields(ctx),
    });
  });
  return (await mapLines(`${LINE_SELECT} WHERE id = $1`, [newId]))[0];
}

// --- Scenarios (rule 5) ---

export async function listScenarios(projectId: string, ctx: Ctx) {
  requireRole(ctx, FORECAST_READ_ROLES);
  await ensureBaselineScenario(projectId);
  const r = await db.query<{ id: string; code: string; is_baseline: boolean; created_at: string }>(
    `SELECT id, code, is_baseline, created_at::text AS created_at FROM forecast_scenario WHERE project_id = $1 ORDER BY is_baseline DESC, created_at`,
    [projectId]
  );
  return r.rows;
}

export async function createScenario(projectId: string, input: { code: string }, ctx: Ctx) {
  requireRole(ctx, FORECAST_WRITE_ROLES);
  if (input.code === "BASE") throw new AppError("validation", "BASE is the reserved baseline scenario", "code");
  const id = "fs_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    await tx.query(`INSERT INTO forecast_scenario (id, project_id, code, is_baseline, created_by) VALUES ($1,$2,$3,false,$4)`, [id, projectId, input.code, ctx.actor.user_id]);
    await appendEvent(tx, {
      type: "scenario.created",
      entity_type: "forecast_scenario",
      entity_id: id,
      project_id: projectId,
      payload: { code: input.code },
      ...actorFields(ctx),
    });
  });
  return { id, project_id: projectId, code: input.code, is_baseline: false };
}

export async function putScenarioAssumptions(scenarioId: string, assumptions: { key: string; value: number; note?: string }[], ctx: Ctx) {
  requireRole(ctx, FORECAST_WRITE_ROLES);
  const scenario = await db.query<{ id: string; project_id: string; is_baseline: boolean }>(`SELECT id, project_id, is_baseline FROM forecast_scenario WHERE id = $1`, [scenarioId]);
  if (!scenario.rows[0]) throw new AppError("not_found", "scenario not found");
  if (scenario.rows[0].is_baseline) throw new AppError("validation", "BASE never takes assumptions — rule 5: it is never modified"); // t4

  await withTx(undefined, async (tx) => {
    for (const a of assumptions) {
      await tx.query(
        `INSERT INTO forecast_assumption (id, scenario_id, key, value, note) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (scenario_id, key) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note`,
        ["fa_" + randomUUID().slice(0, 8), scenarioId, a.key, a.value, a.note ?? null]
      );
    }
    await appendEvent(tx, {
      type: "scenario.updated",
      entity_type: "forecast_scenario",
      entity_id: scenarioId,
      project_id: scenario.rows[0].project_id,
      payload: { keys: assumptions.map((a) => a.key) },
      ...actorFields(ctx),
    });
  });
  return listScenarios(scenario.rows[0].project_id, ctx);
}

// --- Snapshots (rule 3) ---

export async function takeSnapshot(projectId: string, kind: "MONTH_START" | "WEEKLY" | "MANUAL", ctx: Ctx | undefined, asOf: string = today()): Promise<{ id: string }> {
  if (ctx) requireRole(ctx, FORECAST_WRITE_ROLES);
  // Standalone entrypoint (cron-driven, not preceded by getForecast) — derive here same as
  // getForecast does, so a snapshot taken cold still reflects current demand state.
  await deriveProjectLines(projectId, asOf, db, ctx);
  const baselineId = await ensureBaselineScenario(projectId);
  const { from, to } = defaultRange(asOf);
  const view = await buildForecastView(projectId, { scenario: "BASE", from, to, lane: "COMMITTED" }, ctx);

  const totals = view.periods.reduce<Record<string, { expected: number; weighted: number; by_source_type: Record<string, number> }>>((acc, p) => {
    const bySource: Record<string, number> = {};
    for (const l of view.lines.filter((x) => x.period === p.period)) {
      bySource[l.source_type] = (bySource[l.source_type] ?? 0) + l.amount_inr * l.probability;
    }
    // Data row's two names, kept distinct: `expected` is the raw (unweighted) sum raised in the
    // period, `weighted` is the probability-weighted total the waterfall actually carries forward.
    acc[p.period] = { expected: p.demands_raised, weighted: p.expected_weighted + p.overdue_recovery_weighted + p.loan_inflow_weighted, by_source_type: bySource };
    return acc;
  }, {});

  const id = "fsnap_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    await tx.query(
      `INSERT INTO forecast_snapshot (id, project_id, scenario_id, kind, period_from, period_to, lines, totals, taken_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [id, projectId, baselineId, kind, from, to, JSON.stringify(view.lines), JSON.stringify(totals), ctx?.actor.user_id ?? null]
    );
    // System-taken snapshots (no ctx — rule 3's 00:05 IST/weekly-Monday cadence, no scheduler
    // exists to call this automatically yet) still get the event; appendEvent defaults
    // actor_kind/actor_user_id to SYSTEM when actorFields isn't spread (P5's own convention).
    await appendEvent(tx, {
      type: "forecast.snapshot_taken",
      entity_type: "forecast_snapshot",
      entity_id: id,
      project_id: projectId,
      payload: { kind, period_from: from, period_to: to },
      ...(ctx ? actorFields(ctx) : {}),
    });
  });
  return { id };
}

export async function listSnapshots(projectId: string, ctx: Ctx) {
  requireRole(ctx, FORECAST_READ_ROLES);
  const r = await db.query(`SELECT id, kind, taken_at::text AS taken_at, period_from, period_to, taken_by FROM forecast_snapshot WHERE project_id = $1 ORDER BY taken_at DESC`, [projectId]);
  return r.rows;
}

// --- Comparison (rule 6) ---

export interface CompareResult {
  period: string;
  actual: number;
  forecast_at_month_start: number | null;
  latest: number;
  actual_to_date: number;
}

async function actualReceived(projectId: string, period: string, upTo: string | null): Promise<number> {
  const [y, m] = period.split("-").map(Number);
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const end = upTo && upTo < periodEnd ? upTo : periodEnd;
  const r = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM receipt WHERE project_id = $1 AND status IN ('posted','reconciled') AND verification != 'DISPUTED' AND received_at BETWEEN $2 AND $3`,
    [projectId, periodStart, end]
  );
  return r.rows[0]?.total ?? 0;
}

export async function compareForecast(projectId: string, period: string, ctx: Ctx): Promise<CompareResult> {
  requireRole(ctx, FORECAST_READ_ROLES);
  const asOf = today();

  const snapshot = await db.query<{ totals: Record<string, { weighted: number }> }>(
    `SELECT totals FROM forecast_snapshot WHERE project_id = $1 AND kind = 'MONTH_START' AND period_from <= $2 AND period_to >= $2 ORDER BY taken_at DESC LIMIT 1`,
    [projectId, period]
  );
  const monthStartTotals = snapshot.rows[0]?.totals;
  // Compared against `latest` below (also probability-weighted) — rule 6 is "forecast vs actual",
  // not "raw demand vs actual", so this reads the weighted figure, not the raw `expected` one.
  const forecastAtMonthStart = monthStartTotals?.[period]?.weighted ?? null;

  const latestView = await buildForecastView(projectId, { scenario: "BASE", from: period, to: period, lane: "COMMITTED" }, ctx);
  const latestPeriod = latestView.periods[0];
  const latest = latestPeriod ? latestPeriod.expected_weighted + latestPeriod.overdue_recovery_weighted + latestPeriod.loan_inflow_weighted : 0;

  return {
    period,
    actual: await actualReceived(projectId, period, null),
    forecast_at_month_start: forecastAtMonthStart,
    latest,
    actual_to_date: await actualReceived(projectId, period, asOf),
  };
}

export async function portfolioCompare(period: string, ctx: Ctx): Promise<(CompareResult & { project_id: string; project_name: string })[]> {
  requireRole(ctx, FORECAST_READ_ROLES);
  const projects = await db.query<{ id: string; name: string }>(`SELECT id, name FROM project`);
  const out: (CompareResult & { project_id: string; project_name: string })[] = [];
  for (const p of projects.rows) {
    const cmp = await compareForecast(p.id, period, ctx);
    out.push({ ...cmp, project_id: p.id, project_name: p.name });
  }
  return out;
}
