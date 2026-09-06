// 27-management-control-tower.md rule 4 — one query function per KPI code, each assembling raw
// facts and handing them to kpis/math.ts's pure formulas. `KPI_QUERIES` is the only place a
// `kpi_definition.formula_ref` string is resolved to code — same "registry, never eval'd" safety
// discipline as studio/core.ts's TABLE_REGISTRY.

import { db } from "../db";
import type { DbLike } from "../events";
import { percentOf, average, sum, ratePer, forecastAccuracy, type KpiResult } from "./math";

type KpiQuery = (projectId: string, period: string, handle: DbLike) => Promise<KpiResult>;

const NULL_RESULT: KpiResult = { value: null, numerator: 0, denominator: 0 };

// --- SALES_HANDOVER ---

async function shFtrPct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  // First-Time-Right: accepted on the first submission (no RETURNED row ever existed for it).
  // `sales_handover` carries no submission-count column, so "never returned" is read from the
  // absence of a return stamp (returned_at) on an ACCEPTED row — a handover that was returned and
  // later re-submitted+accepted still carries its own returned_at, so this is exact, not a proxy.
  const r = await h.query<{ ftr: string; total: string }>(
    `SELECT count(*) FILTER (WHERE status = 'ACCEPTED' AND returned_at IS NULL) AS ftr, count(*) FILTER (WHERE status = 'ACCEPTED') AS total
       FROM sales_handover WHERE project_id = $1`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.ftr ?? 0), Number(r.rows[0]?.total ?? 0));
}

async function shHandoverCycleDays(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ days: number }>(
    `SELECT EXTRACT(EPOCH FROM (accepted_at - submitted_at)) / 86400 AS days
       FROM sales_handover WHERE project_id = $1 AND status = 'ACCEPTED' AND submitted_at IS NOT NULL`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.days)));
}

// --- JOURNEY ---

async function jOnTimePct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  // Honest, if currently uninteresting: 06's own Build note flags planned/forecast/actual as
  // always in sync (no variance model wired yet) — this reads the real columns regardless, so the
  // number sharpens the moment that gap closes, rather than being invented now.
  const r = await h.query<{ on_time: string; total: string }>(
    `SELECT count(*) FILTER (WHERE si.actual_end <= si.planned_end) AS on_time, count(*) AS total
       FROM stage_instance si JOIN journey_instance ji ON ji.id = si.journey_id
      WHERE ji.project_id = $1 AND si.status = 'COMPLETED' AND si.actual_end IS NOT NULL`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.on_time ?? 0), Number(r.rows[0]?.total ?? 0));
}

async function jStageSlippageDays(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ days: number }>(
    `SELECT (si.actual_end - si.planned_end) AS days
       FROM stage_instance si JOIN journey_instance ji ON ji.id = si.journey_id
      WHERE ji.project_id = $1 AND si.status = 'COMPLETED' AND si.actual_end IS NOT NULL`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.days)));
}

async function jSlaBreachPct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ breached: string; total: string }>(
    `SELECT count(*) FILTER (WHERE sc.outcome = 'LATE') AS breached, count(*) AS total
       FROM sla_clock sc JOIN action a ON a.sla_clock_id = sc.id
      WHERE a.project_id = $1 AND sc.outcome IS NOT NULL`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.breached ?? 0), Number(r.rows[0]?.total ?? 0));
}

// --- COLLECTIONS (19) ---

async function cEfficiencyPct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  // Collected ÷ billed-so-far. "Billed" is every demand actually raised (status moves off
  // 'scheduled' once its construction trigger fires — collections.ts's own DemandStatus union);
  // demand.amount is the fixed original milestone amount, never adjusted down as receipts land,
  // so summing it once per raised demand (not per status bucket) avoids double-counting a
  // part-paid demand's already-received receipts against its own still-outstanding amount.
  const r = await h.query<{ collected: number; due: number }>(
    `SELECT COALESCE((SELECT SUM(amount) FROM receipt WHERE project_id = $1), 0)::float8 AS collected,
            COALESCE((SELECT SUM(amount) FROM demand WHERE project_id = $1 AND status <> 'scheduled'), 0)::float8 AS due`,
    [projectId]
  );
  return percentOf(r.rows[0]?.collected ?? 0, r.rows[0]?.due ?? 0);
}

async function cOverdueInr(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ total: number }>(`SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM demand WHERE project_id = $1 AND status = 'overdue'`, [projectId]);
  return sum([r.rows[0]?.total ?? 0]);
}

async function cTrueRiskInr(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ total: number }>(
    `SELECT COALESCE(SUM(d.amount), 0)::float8 AS total FROM demand d
      WHERE d.project_id = $1 AND d.status = 'overdue' AND d.overdue_reason_code = 'unresponsive'`,
    [projectId]
  );
  return sum([r.rows[0]?.total ?? 0]);
}

async function cForecastAccuracyPct(projectId: string, period: string, h: DbLike): Promise<KpiResult> {
  const snap = await h.query<{ totals: Record<string, { weighted: number }> }>(
    `SELECT totals FROM forecast_snapshot WHERE project_id = $1 AND kind = 'MONTH_START' AND period_from <= $2 AND period_to >= $2 ORDER BY taken_at DESC LIMIT 1`,
    [projectId, period]
  );
  const forecast = snap.rows[0]?.totals?.[period]?.weighted;
  if (forecast === undefined) return NULL_RESULT; // no snapshot taken for this period yet — honest no-data, not 0
  const actual = await h.query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM receipt WHERE project_id = $1 AND to_char(received_at, 'YYYY-MM') = $2`,
    [projectId, period]
  );
  return forecastAccuracy(forecast, actual.rows[0]?.total ?? 0);
}

async function cPtpHonourPct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ honoured: string; broken: string }>(
    `SELECT
       count(*) FILTER (WHERE p.converted_receipt_id IS NOT NULL) AS honoured,
       count(*) FILTER (WHERE p.converted_receipt_id IS NULL AND p.expected_date < CURRENT_DATE) AS broken
     FROM promise_to_pay p JOIN demand d ON d.id = p.demand_id WHERE d.project_id = $1`,
    [projectId]
  );
  const honoured = Number(r.rows[0]?.honoured ?? 0), broken = Number(r.rows[0]?.broken ?? 0);
  return percentOf(honoured, honoured + broken);
}

// --- LEGAL_REGISTRATION (22/23) ---

async function lrCycleDays(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  // No single column spans a registration case's full lifecycle — derived from its own event
  // log (registration.availability_confirmed -> registration.completed), same "timestamp from the
  // event, not an invented column" pattern 11's myday already used for `action.created_at`.
  const r = await h.query<{ days: number }>(
    `SELECT EXTRACT(EPOCH FROM (done.occurred_at - start.occurred_at)) / 86400 AS days
       FROM event done JOIN event start ON start.booking_id = done.booking_id
      WHERE done.type = 'registration.completed' AND start.type = 'registration.availability_confirmed'
        AND done.project_id = $1 AND start.occurred_at < done.occurred_at`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.days)));
}

async function lrDeviationRatePct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ deviated: string; total: string }>(
    `SELECT count(DISTINCT dd.document_id) AS deviated, count(DISTINCT dfd.id) AS total
       FROM doc_factory_document dfd LEFT JOIN document_deviation dd ON dd.document_id = dfd.id
      WHERE dfd.project_id = $1`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.deviated ?? 0), Number(r.rows[0]?.total ?? 0));
}

async function lrRegistrationSlippageDays(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ days: number }>(
    `SELECT (executed_on - forecast_date) AS days
       FROM registration_case WHERE project_id = $1 AND executed_on IS NOT NULL AND forecast_date IS NOT NULL`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.days)));
}

// --- QUALITY_HANDOVER (15/16) ---

async function qSnagClosurePct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ closed: string; total: string }>(
    `SELECT count(*) FILTER (WHERE status IN ('closed', 'verified')) AS closed, count(*) AS total FROM snag WHERE project_id = $1`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.closed ?? 0), Number(r.rows[0]?.total ?? 0));
}

async function qRepeatDefectsPct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ repeat: string; total: string }>(
    `SELECT count(*) FILTER (WHERE is_repeat) AS repeat, count(*) AS total FROM snag WHERE project_id = $1`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.repeat ?? 0), Number(r.rows[0]?.total ?? 0));
}

async function qCriticalSnagAgeDays(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ days: number }>(
    `SELECT EXTRACT(EPOCH FROM (now() - ev.occurred_at)) / 86400 AS days
       FROM snag s JOIN event ev ON ev.entity_type = 'snag' AND ev.entity_id = s.id AND ev.type = 'snag.opened'
      WHERE s.project_id = $1 AND s.severity = 'critical' AND s.status NOT IN ('closed', 'verified')`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.days)));
}

async function hOnTimePct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  // "On time" against the confirmed appointment slot itself — the honest comparison here,
  // since 06 carries no independent handover-stage forecast date (rule 3's own flagged gap).
  // INNER JOIN, not LEFT: a completion with no confirmed-appointment row (the legacy seed-lifecycle
  // path via qa.ts's own direct handover_record insert, which creates no appointment) has nothing
  // to compare against and must be excluded from both on_time and total, not silently counted late.
  const r = await h.query<{ on_time: string; total: string }>(
    `SELECT count(*) FILTER (WHERE hr.completed_at::date <= ha.confirmed_slot::date) AS on_time, count(*) AS total
       FROM handover_record hr JOIN handover_appointment ha ON ha.case_id = hr.id AND ha.confirmed_slot IS NOT NULL
      WHERE hr.project_id = $1 AND hr.status = 'completed' AND hr.completed_at IS NOT NULL`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.on_time ?? 0), Number(r.rows[0]?.total ?? 0));
}

async function hOverrideCount(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ total: string }>(
    `SELECT count(*) AS total FROM handover_override ho JOIN handover_record hr ON hr.id = ho.case_id WHERE hr.project_id = $1`,
    [projectId]
  );
  return sum([Number(r.rows[0]?.total ?? 0)]);
}

// --- CUSTOMISATION (18) ---

async function cuCycleTimeDays(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ days: number }>(
    `SELECT EXTRACT(EPOCH FROM (as_built_closed_at - created_at)) / 86400 AS days
       FROM change_request WHERE project_id = $1 AND as_built_closed_at IS NOT NULL`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.days)));
}

async function cuApprovalTimeDays(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ days: number }>(
    `SELECT EXTRACT(EPOCH FROM (cra.decided_at - cra.created_at)) / 86400 AS days
       FROM change_request_approval cra JOIN change_request cr ON cr.id = cra.cr_id
      WHERE cr.project_id = $1 AND cra.decision = 'APPROVED'`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.days)));
}

async function cuReleaseBeforePaymentCount(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ total: string }>(`SELECT count(*) AS total FROM change_request WHERE project_id = $1 AND payment_gate = 'WAIVED'`, [projectId]);
  return sum([Number(r.rows[0]?.total ?? 0)]);
}

// --- shared: variation contribution (feeds both CUSTOMISATION and PROFITABILITY, rule 6) ---

async function variationContributionInr(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ total: number }>(`SELECT COALESCE(SUM(amount_inr), 0)::float8 AS total FROM economic_event WHERE project_id = $1 AND kind = 'VARIATION_CONTRIBUTION'`, [projectId]);
  return sum([r.rows[0]?.total ?? 0]);
}

// --- POST_HANDOVER ---

async function phWarrantyTatDays(_projectId: string, _period: string, _h: DbLike): Promise<KpiResult> {
  // Flagged, not faked: `warranty_case` has no raised-at column and no creation event
  // (`warranty.case_closed` is the only event type warranty.ts appends) — there is no real signal
  // anywhere in this codebase for when a case was opened, so TAT cannot be computed honestly yet.
  return NULL_RESULT;
}

async function phDlpClosurePct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ closed: string; total: string }>(
    `SELECT count(*) FILTER (WHERE status = 'closed') AS closed, count(*) AS total FROM dlp_window WHERE project_id = $1`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.closed ?? 0), Number(r.rows[0]?.total ?? 0));
}

// --- EXPERIENCE ---

async function exCheckinScore(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ score: number }>(
    `SELECT ci.score::float8 AS score FROM customer_check_in ci JOIN booking b ON b.id = ci.booking_id WHERE b.project_id = $1 AND ci.score IS NOT NULL`,
    [projectId]
  );
  return average(r.rows.map((x) => Number(x.score)));
}

async function exEscalationsPer100(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const esc = await h.query<{ total: string }>(`SELECT count(*) AS total FROM escalation WHERE project_id = $1`, [projectId]);
  const customers = await h.query<{ total: string }>(
    `SELECT count(DISTINCT ba.customer_id) AS total FROM booking b JOIN booking_applicant ba ON ba.booking_id = b.id WHERE b.project_id = $1`,
    [projectId]
  );
  return ratePer(Number(esc.rows[0]?.total ?? 0), 100, Number(customers.rows[0]?.total ?? 0));
}

async function exCommitmentFulfilmentPct(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ fulfilled: string; total: string }>(
    `SELECT count(*) FILTER (WHERE status = 'FULFILLED') AS fulfilled, count(*) FILTER (WHERE status NOT IN ('DRAFT', 'CANCELLED')) AS total
       FROM commitment WHERE project_id = $1`,
    [projectId]
  );
  return percentOf(Number(r.rows[0]?.fulfilled ?? 0), Number(r.rows[0]?.total ?? 0));
}

// --- PROFITABILITY (rule 6, all from economic_event) ---

async function prLeakageInr(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ total: number }>(`SELECT COALESCE(SUM(amount_inr), 0)::float8 AS total FROM economic_event WHERE project_id = $1 AND kind IN ('COMMERCIAL_LEAKAGE', 'SERVICE_LEAKAGE')`, [projectId]);
  return sum([r.rows[0]?.total ?? 0]);
}

async function prDelayCostInr(projectId: string, _period: string, h: DbLike): Promise<KpiResult> {
  const r = await h.query<{ total: number }>(`SELECT COALESCE(SUM(amount_inr), 0)::float8 AS total FROM economic_event WHERE project_id = $1 AND kind = 'DELAY_COST'`, [projectId]);
  return sum([r.rows[0]?.total ?? 0]);
}

export const KPI_QUERIES: Record<string, KpiQuery> = {
  sh_ftr_pct: shFtrPct,
  sh_handover_cycle_days: shHandoverCycleDays,
  j_on_time_pct: jOnTimePct,
  j_stage_slippage_days: jStageSlippageDays,
  j_sla_breach_pct: jSlaBreachPct,
  c_efficiency_pct: cEfficiencyPct,
  c_overdue_inr: cOverdueInr,
  c_true_risk_inr: cTrueRiskInr,
  c_forecast_accuracy_pct: cForecastAccuracyPct,
  c_ptp_honour_pct: cPtpHonourPct,
  lr_cycle_days: lrCycleDays,
  lr_deviation_rate_pct: lrDeviationRatePct,
  lr_registration_slippage_days: lrRegistrationSlippageDays,
  q_snag_closure_pct: qSnagClosurePct,
  q_repeat_defects_pct: qRepeatDefectsPct,
  q_critical_snag_age_days: qCriticalSnagAgeDays,
  h_on_time_pct: hOnTimePct,
  h_override_count: hOverrideCount,
  cu_cycle_time_days: cuCycleTimeDays,
  cu_approval_time_days: cuApprovalTimeDays,
  cu_contribution_inr: variationContributionInr,
  cu_release_before_payment_count: cuReleaseBeforePaymentCount,
  ph_warranty_tat_days: phWarrantyTatDays,
  ph_dlp_closure_pct: phDlpClosurePct,
  ex_checkin_score: exCheckinScore,
  ex_escalations_per_100: exEscalationsPer100,
  ex_commitment_fulfilment_pct: exCommitmentFulfilmentPct,
  pr_leakage_inr: prLeakageInr,
  pr_variation_contribution_inr: variationContributionInr,
  pr_delay_cost_inr: prDelayCostInr,
};

export async function computeKpi(code: string, projectId: string, period: string, handle: DbLike = db): Promise<KpiResult> {
  const fn = KPI_QUERIES[code];
  if (!fn) return NULL_RESULT;
  return fn(projectId, period, handle);
}
