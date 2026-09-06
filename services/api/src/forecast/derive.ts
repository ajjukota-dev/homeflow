// 20-cash-forecast.md rule 1 — lines are derived, never typed (except MANUAL_FINANCE_OVERRIDE).
// One pass per demand with an explicit precedence order (not four independent derivation passes
// that each insert and hope the bookkeeping lines up — advisor review, pre-build): a demand can
// be loan-dependent AND carry an active promise-to-pay at the same time, so `resolveDemandLine`
// picks exactly one winner per demand, deterministically, and the IO layer diffs that winner
// against whatever's currently ACTIVE for the demand to decide SUPERSEDED/LAPSED/REALISED/insert.
// This single diff also implements rule 7 (realisation/lapse) — there is no separate "sweep" pass.
//
// APPROVED_RESCHEDULE is deliberately NOT derived here: `timeline_plan_revision.changes` (06) is
// a jsonb array of {stage_code, old_planned_start, new_planned_start} — stage dates, no amount and
// no demand_id. There is no schema path from a plan revision to a specific rupee, so a query
// against it could not produce a valid forecast_line row even in principle (06 also never writes
// that table today — see its own build note — so this is doubly unreachable, not just unwired).
// Flagged, not built. SCENARIO_FUTURE_SALES is computed at read time in core.ts, never persisted
// here (see that module's header) — scenario assumption lines are pure and reproducible, same
// "compute-on-read, no scheduler" precedent as scores/store.ts.

import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { DbLike } from "../events";
import { appendEvent, actorFields } from "../events";
import type { Ctx } from "../authz/types";
import { daysOverdue as daysOverdueOf } from "../collections";
import { computeProbability, type ForecastSourceType, type ProbabilityDriver } from "./probability";

export type ForecastLineStatus = "ACTIVE" | "REALISED" | "LAPSED" | "SUPERSEDED";

export interface DerivedLine {
  demand_id: string | null;
  loan_case_id: string | null;
  source_type: ForecastSourceType;
  expected_date: string;
  amount_inr: number;
  probability: number;
  probability_drivers: ProbabilityDriver[];
}

export interface DemandFacts {
  demand_id: string;
  booking_id: string;
  project_id: string;
  loan_case_id: string | null;
  remaining: number;
  due_date: string | null;
  status: string; // collections.ts's DemandStatus
  overdue_reason_label: string | null;
  ever_late: boolean;
  active_ptp: { expected_date: string; expected_amount: number } | null;
  ptp_honoured_count: number;
  ptp_total_count: number;
  loan_dependent: boolean;
  loan_stage: string | null;
  loan_expected_disbursement_date: string | null;
}

/** Rule 1's precedence for a single demand, most-specific-signal-wins:
 *  loan disbursement (a bank commitment) > an active customer promise > plain overdue ageing >
 *  the original contractual date. Manual overrides are handled by the caller (they short-circuit
 *  before this function is even called — see deriveProjectLines). */
export function resolveDemandLine(facts: DemandFacts, asOf: string): DerivedLine | null {
  if (facts.remaining <= 0) return null;
  if (facts.status === "settled" || facts.status === "waived") return null;

  if (facts.loan_dependent) {
    if (!facts.loan_expected_disbursement_date) return null; // no date yet — nothing confident to forecast
    const { probability, drivers } = computeProbability({
      source_type: "LOAN_DISBURSEMENT",
      loanDisbursement: { stage: facts.loan_stage ?? "APPLICATION" },
    });
    return {
      demand_id: facts.demand_id,
      loan_case_id: facts.loan_case_id,
      source_type: "LOAN_DISBURSEMENT",
      expected_date: facts.loan_expected_disbursement_date,
      amount_inr: facts.remaining,
      probability,
      probability_drivers: drivers,
    };
  }

  if (facts.active_ptp) {
    const { probability, drivers } = computeProbability({
      source_type: "PROMISE_TO_PAY",
      promiseToPay: { honouredCount: facts.ptp_honoured_count, totalCount: facts.ptp_total_count },
    });
    return {
      demand_id: facts.demand_id,
      loan_case_id: null,
      source_type: "PROMISE_TO_PAY",
      expected_date: facts.active_ptp.expected_date,
      amount_inr: Math.min(facts.active_ptp.expected_amount, facts.remaining),
      probability,
      probability_drivers: drivers,
    };
  }

  const isOverdue = facts.status === "overdue" || (facts.due_date !== null && facts.due_date < asOf);
  if (isOverdue && facts.due_date !== null) {
    const days = daysOverdueOf(facts.due_date, asOf);
    const { probability, drivers } = computeProbability({
      source_type: "OVERDUE_RECOVERY",
      overdueRecovery: { daysOverdue: days, reasonLabel: facts.overdue_reason_label },
    });
    return {
      demand_id: facts.demand_id,
      loan_case_id: null,
      source_type: "OVERDUE_RECOVERY",
      expected_date: facts.due_date,
      amount_inr: facts.remaining,
      probability,
      probability_drivers: drivers,
    };
  }

  if (facts.due_date !== null) {
    const { probability, drivers } = computeProbability({ source_type: "CONTRACTUAL_DUE", contractualDue: { everLate: facts.ever_late } });
    return {
      demand_id: facts.demand_id,
      loan_case_id: null,
      source_type: "CONTRACTUAL_DUE",
      expected_date: facts.due_date,
      amount_inr: facts.remaining,
      probability,
      probability_drivers: drivers,
    };
  }

  return null; // construction trigger hasn't fired yet — no known date to forecast
}

interface ActiveLineRow {
  id: string;
  demand_id: string;
  source_type: ForecastSourceType;
  expected_date: string;
  amount_inr: number;
  probability: number;
}

function sameLine(a: ActiveLineRow, b: DerivedLine): boolean {
  return (
    a.source_type === b.source_type &&
    a.expected_date === b.expected_date &&
    Math.abs(a.amount_inr - b.amount_inr) < 0.5 &&
    Math.abs(a.probability - b.probability) < 1e-6
  );
}

/** Rule 1 (derive/supersede) + rule 7 (realise/lapse) in one diff per demand. Persist-on-change
 *  discipline (gates.ts/registration's own precedent) — a demand whose winner hasn't changed
 *  since the last run writes nothing. Returns the count of demands whose line changed, for the
 *  caller's event emission. */
export async function deriveProjectLines(projectId: string, asOf: string, tx: DbLike = db, ctx?: Ctx): Promise<{ changed: number }> {
  const demandRows = await tx.query<{
    id: string;
    booking_id: string;
    remaining: number;
    due_date: string | null;
    status: string;
    overdue_reason_label: string | null;
    ever_late: boolean;
    loan_case_id: string | null;
    loan_dependent: boolean;
    loan_stage: string | null;
    loan_expected_disbursement_date: string | null;
    ptp_expected_date: string | null;
    ptp_expected_amount: number | null;
    ptp_honoured_count: number;
    ptp_total_count: number;
  }>(
    `SELECT d.id, d.booking_id,
            (d.amount - COALESCE((SELECT SUM(r.amount) FROM receipt r WHERE r.demand_id = d.id AND r.status IN ('posted','reconciled') AND r.verification != 'DISPUTED'), 0)
                      - COALESCE((SELECT SUM(w.amount) FROM waiver w WHERE w.demand_id = d.id AND w.status = 'APPROVED'), 0))::float8 AS remaining,
            d.due_date::text AS due_date, d.status,
            o.label AS overdue_reason_label,
            EXISTS (SELECT 1 FROM demand d2 WHERE d2.booking_id = d.booking_id AND d2.overdue_reason_code IS NOT NULL AND d2.id != d.id) AS ever_late,
            d.loan_dependent,
            lc.id AS loan_case_id, lc.stage AS loan_stage, lc.expected_disbursement_date::text AS loan_expected_disbursement_date,
            ptp.expected_date::text AS ptp_expected_date, ptp.expected_amount::float8 AS ptp_expected_amount,
            (SELECT COUNT(*) FROM promise_to_pay p2 JOIN demand d3 ON d3.id = p2.demand_id WHERE d3.booking_id = d.booking_id AND p2.converted_receipt_id IS NOT NULL)::int AS ptp_honoured_count,
            (SELECT COUNT(*) FROM promise_to_pay p3 JOIN demand d4 ON d4.id = p3.demand_id WHERE d4.booking_id = d.booking_id)::int AS ptp_total_count
       FROM demand d
       LEFT JOIN overdue_reason o ON o.code = d.overdue_reason_code
       LEFT JOIN loan_case lc ON lc.booking_id = d.booking_id AND lc.stage NOT IN ('CLOSED', 'REJECTED', 'WITHDRAWN')
       LEFT JOIN LATERAL (
         SELECT expected_date, expected_amount FROM promise_to_pay
          WHERE demand_id = d.id AND converted_receipt_id IS NULL ORDER BY expected_date DESC LIMIT 1
       ) ptp ON true
      WHERE d.project_id = $1`,
    [projectId]
  );

  // Demands with a live manual override are left untouched entirely — the override IS the active
  // line, and re-deriving would immediately clobber it (rule 1: overrides supersede the derived
  // line, not the other way around).
  const overridden = await tx.query<{ demand_id: string }>(
    `SELECT demand_id FROM forecast_line WHERE project_id = $1 AND lane = 'COMMITTED' AND status = 'ACTIVE' AND source_type = 'MANUAL_FINANCE_OVERRIDE' AND demand_id IS NOT NULL`,
    [projectId]
  );
  const overriddenDemandIds = new Set(overridden.rows.map((r) => r.demand_id));

  const activeLines = await tx.query<ActiveLineRow & { demand_id: string }>(
    `SELECT id, demand_id, source_type, expected_date::text AS expected_date, amount_inr::float8 AS amount_inr, probability::float8 AS probability
       FROM forecast_line WHERE project_id = $1 AND lane = 'COMMITTED' AND status = 'ACTIVE' AND demand_id IS NOT NULL AND source_type != 'MANUAL_FINANCE_OVERRIDE'`,
    [projectId]
  );
  const activeByDemand = new Map(activeLines.rows.map((r) => [r.demand_id, r]));

  let changed = 0;
  for (const d of demandRows.rows) {
    if (overriddenDemandIds.has(d.id)) continue;

    const facts: DemandFacts = {
      demand_id: d.id,
      booking_id: d.booking_id,
      project_id: projectId,
      loan_case_id: d.loan_case_id,
      remaining: d.remaining,
      due_date: d.due_date,
      status: d.status,
      overdue_reason_label: d.overdue_reason_label,
      ever_late: d.ever_late,
      active_ptp: d.ptp_expected_date && d.ptp_expected_amount !== null ? { expected_date: d.ptp_expected_date, expected_amount: d.ptp_expected_amount } : null,
      ptp_honoured_count: d.ptp_honoured_count,
      ptp_total_count: d.ptp_total_count,
      loan_dependent: d.loan_dependent,
      loan_stage: d.loan_stage,
      loan_expected_disbursement_date: d.loan_expected_disbursement_date,
    };

    const winner = resolveDemandLine(facts, asOf);
    const existing = activeByDemand.get(d.id);

    if (winner && existing && sameLine(existing, winner)) continue; // no-op, nothing changed
    if (!winner && !existing) continue; // never had a line, still doesn't need one

    if (existing) {
      const closingStatus: ForecastLineStatus = d.remaining <= 0 ? "REALISED" : existing.expected_date < asOf ? "LAPSED" : "SUPERSEDED";
      await tx.query(`UPDATE forecast_line SET status = $1 WHERE id = $2`, [closingStatus, existing.id]);
      if (ctx) {
        await appendEvent(tx, {
          type: closingStatus === "REALISED" ? "forecast.line_realised" : closingStatus === "LAPSED" ? "forecast.line_lapsed" : "forecast.line_superseded",
          entity_type: "forecast_line",
          entity_id: existing.id,
          project_id: projectId,
          booking_id: d.booking_id,
          payload: { demand_id: d.id, previous_source_type: existing.source_type },
          ...actorFields(ctx),
        });
      }
    }

    if (winner) {
      const id = "fl_" + randomUUID().slice(0, 8);
      await tx.query(
        `INSERT INTO forecast_line (id, project_id, booking_id, demand_id, loan_case_id, source_type, lane, expected_date, amount_inr, probability, probability_drivers, period, status)
         VALUES ($1,$2,$3,$4,$5,$6,'COMMITTED',$7,$8,$9,$10::jsonb,$11,'ACTIVE')`,
        [id, projectId, d.booking_id, d.id, winner.loan_case_id, winner.source_type, winner.expected_date, winner.amount_inr, winner.probability, JSON.stringify(winner.probability_drivers), winner.expected_date.slice(0, 7)]
      );
      if (ctx) {
        await appendEvent(tx, {
          type: "forecast.line_derived",
          entity_type: "forecast_line",
          entity_id: id,
          project_id: projectId,
          booking_id: d.booking_id,
          payload: { demand_id: d.id, source_type: winner.source_type, amount_inr: winner.amount_inr },
          ...actorFields(ctx),
        });
      }
    }
    changed++;
  }

  changed += await deriveRegistrationFinalDemandLines(projectId, tx);
  return { changed };
}

/** REGISTRATION_FINAL_DEMAND: `registration_case.stamp_duty_inr`/`registration_fee_inr` (23) are
 *  only ever written by `recordExecution` — the same call that sets `executed_on` — so by the time
 *  either value exists, registration has already happened, not merely been slotted. This source
 *  type is therefore honestly unreachable pre-execution today (23's own build note already flags
 *  needing "20's forecast_line / a payment_plan flag, neither built" for a true forward forecast).
 *  What IS real: once executed, it's a genuine historical rupee — recorded here as an immediately
 *  REALISED line (probability 1, not a forward estimate) so it still shows in the Actual column,
 *  one-shot per booking (no diffing needed — these two columns are never edited after being set). */
async function deriveRegistrationFinalDemandLines(projectId: string, tx: DbLike): Promise<number> {
  const rows = await tx.query<{ id: string; booking_id: string; executed_on: string; stamp_duty_inr: number; registration_fee_inr: number }>(
    `SELECT rc.id, rc.booking_id, rc.executed_on::text AS executed_on, rc.stamp_duty_inr::float8 AS stamp_duty_inr, rc.registration_fee_inr::float8 AS registration_fee_inr
       FROM registration_case rc
      WHERE rc.project_id = $1 AND rc.stamp_duty_inr IS NOT NULL AND rc.registration_fee_inr IS NOT NULL AND rc.executed_on IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM forecast_line fl WHERE fl.booking_id = rc.booking_id AND fl.source_type = 'REGISTRATION_FINAL_DEMAND')`,
    [projectId]
  );
  for (const r of rows.rows) {
    const { probability, drivers } = computeProbability({ source_type: "REGISTRATION_FINAL_DEMAND" });
    const amount = r.stamp_duty_inr + r.registration_fee_inr;
    await tx.query(
      `INSERT INTO forecast_line (id, project_id, booking_id, demand_id, source_type, lane, expected_date, amount_inr, probability, probability_drivers, period, status)
       VALUES ($1,$2,$3,NULL,'REGISTRATION_FINAL_DEMAND','COMMITTED',$4,$5,$6,$7::jsonb,$8,'REALISED')`,
      ["fl_" + randomUUID().slice(0, 8), projectId, r.booking_id, r.executed_on, amount, probability, JSON.stringify(drivers), r.executed_on.slice(0, 7)]
    );
  }
  return rows.rows.length;
}

// --- Rule 5 (scenarios): applied only at read time, never persisted — a scenario is a pure
// transform of the COMMITTED-lane lines plus, for future sales, wholly new SCENARIO-lane lines.
// Re-running it always reproduces the same result, so there is nothing to diff or store (same
// "compute-on-read, no scheduler" precedent as scores/store.ts). This is also what makes "BASE is
// never modified" trivially true: BASE is just deriveProjectLines's COMMITTED output, untouched.

export interface ScenarioAssumptions {
  collection_efficiency_pct?: number;
  loan_disbursement_lag_days?: number;
  future_sales_per_month?: number;
  future_sale_ticket_inr?: number;
  construction_slip_days?: number;
  ptp_honour_pct?: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Rule 5: apply a scenario's assumptions to a copy of the committed lines. Efficiency/slip only
 *  touch the two "customer pays on their own schedule" source types; loan lag only touches
 *  LOAN_DISBURSEMENT; PTP_HONOUR_PCT overrides the honour-rate-derived probability directly
 *  (the assumption IS the rate here, not a further multiplier on it). Every other source type
 *  (MANUAL_FINANCE_OVERRIDE, REGISTRATION_FINAL_DEMAND) passes through unchanged — an override is
 *  by definition a fixed fact the scenario shouldn't second-guess, and a registration line is
 *  already a realised historical amount. */
export function applyScenarioAssumptions(lines: DerivedLine[], assumptions: ScenarioAssumptions): DerivedLine[] {
  const effPct = assumptions.collection_efficiency_pct;
  const slip = assumptions.construction_slip_days ?? 0;
  const lag = assumptions.loan_disbursement_lag_days ?? 0;
  const ptpPct = assumptions.ptp_honour_pct;

  return lines.map((l) => {
    let probability = l.probability;
    let expectedDate = l.expected_date;
    if (l.source_type === "CONTRACTUAL_DUE" || l.source_type === "OVERDUE_RECOVERY") {
      if (effPct !== undefined) probability = clamp01(probability * (effPct / 100));
      if (slip) expectedDate = addDaysToDate(expectedDate, slip);
    } else if (l.source_type === "LOAN_DISBURSEMENT" && lag) {
      expectedDate = addDaysToDate(expectedDate, lag);
    } else if (l.source_type === "PROMISE_TO_PAY" && ptpPct !== undefined) {
      probability = clamp01(ptpPct / 100);
    }
    return { ...l, probability, expected_date: expectedDate };
  });
}

/** Rule 1/5's SCENARIO_FUTURE_SALES: one line per forward month at the assumed ticket price —
 *  never derived from any real booking (there isn't one yet), always SCENARIO lane. */
export function futureSalesLines(assumptions: ScenarioAssumptions, asOf: string, monthsForward = 12): DerivedLine[] {
  const perMonth = assumptions.future_sales_per_month ?? 0;
  const ticket = assumptions.future_sale_ticket_inr ?? 0;
  if (perMonth <= 0 || ticket <= 0) return [];

  const [y0, m0] = asOf.slice(0, 7).split("-").map(Number);
  const lines: DerivedLine[] = [];
  for (let i = 1; i <= monthsForward; i++) {
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 15));
    const expectedDate = d.toISOString().slice(0, 10);
    lines.push({
      demand_id: null,
      loan_case_id: null,
      source_type: "SCENARIO_FUTURE_SALES",
      expected_date: expectedDate,
      amount_inr: perMonth * ticket,
      probability: 1,
      probability_drivers: [{ label: "scenario assumption", value: `${perMonth}/mo @ ₹${ticket.toLocaleString("en-IN")}` }],
    });
  }
  return lines;
}
