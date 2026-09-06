import { db } from "../db";
import { classifyOpenAmount, daysOverdue, recoveryProbability } from "../collections";
import { DEMAND_SELECT, mapDemands, asDate, today } from "../demands";
import { bookingFinance } from "../finance";
import { getClearance } from "../financial-clearance";
import { trendFrom, topDrivers, type Score, type ScoreDriver } from "../scores/contract";
import { previousValue } from "../scores/store";
import { recordScore } from "./shared";
import type { Ctx } from "../authz/types";

// 31-intelligence.md rule 2 — Financial Health, rules over: true-risk share (19), forecast
// variance (20, project-level — a booking inherits its project's variance signal, the same
// "no per-booking equivalent exists" call true-risk share doesn't need since demands ARE
// booking-scoped), loan gap (21), waiver leakage (19/27's own `waiver` table), clearance status
// (19's `financial_clearance`, reused from `getClearance` rather than re-deriving). Per-booking,
// per rule 2's own "booking/project" scope and the API's own `/bookings/:id/scores/financial-health`.
//
// `getClearance` requires a staff Ctx (its own `requireRole(ctx, STAFF_ROLES)`) — this module's
// own callers are already staff-gated (routes-intelligence.ts), so the ctx is threaded through
// rather than re-derived.

const TRUE_RISK_WEIGHT = 20;
const VARIANCE_WEIGHT = 15;
const LOAN_GAP_WEIGHT = 15;
const WAIVER_WEIGHT = 10;
const CLEARANCE_WEIGHT = 10;

interface Built { value: number; allDrivers: ScoreDriver[]; projectId: string }

async function trueRiskShare(bookingId: string, projectId: string, consideration: number): Promise<{ share: number; amount: number }> {
  if (consideration <= 0) return { share: 0, amount: 0 };
  const policy = await db.query<{ true_risk_max_probability: number }>(
    `SELECT true_risk_max_probability::float8 AS true_risk_max_probability FROM collection_policy WHERE project_id = $1`,
    [projectId]
  );
  const threshold = policy.rows[0]?.true_risk_max_probability ?? 0.4;
  const asOf = today();
  const rows = await mapDemands(`${DEMAND_SELECT} WHERE d.booking_id = $1`, [bookingId]);
  let trueRiskAmount = 0;
  for (const row of rows) {
    const dueDate = asDate(row.due_date);
    const ageing = daysOverdue(dueDate, asOf);
    const bucket = classifyOpenAmount({
      remaining: row.remaining, status: row.status, due_date: dueDate, as_of: asOf,
      loan_dependent: row.loan_dependent, has_active_ptp: row.has_active_ptp,
      recovery_probability: recoveryProbability(ageing), true_risk_threshold: threshold,
    });
    if (bucket === "TRUE_RISK") trueRiskAmount += row.remaining;
  }
  return { share: trueRiskAmount / consideration, amount: trueRiskAmount };
}

async function forecastVariancePct(projectId: string, ctx: Ctx): Promise<number | null> {
  // Lazily imported to avoid a hard dependency edge for callers that never hit this path —
  // `compareForecast` requires FORECAST_READ_ROLES, a strict subset of STAFF_ROLES; anyone
  // gated into this module already qualifies.
  const { compareForecast } = await import("../forecast/core");
  const period = today().slice(0, 7);
  try {
    const cmp = await compareForecast(projectId, period, ctx);
    if (cmp.forecast_at_month_start === null || cmp.forecast_at_month_start === 0) return null;
    return (cmp.actual_to_date - cmp.forecast_at_month_start) / cmp.forecast_at_month_start;
  } catch {
    return null; // no snapshot / not authorized for this project — flagged via null, not guessed
  }
}

async function loanGap(bookingId: string): Promise<{ gapPct: number; requested: number; sanctioned: number | null } | null> {
  const r = await db.query<{ requested_amount_inr: number | null; sanctioned_amount_inr: number | null }>(
    `SELECT requested_amount_inr::float8 AS requested_amount_inr, sanctioned_amount_inr::float8 AS sanctioned_amount_inr
       FROM loan_case WHERE booking_id = $1 AND stage NOT IN ('CLOSED', 'REJECTED', 'WITHDRAWN')`,
    [bookingId]
  );
  const row = r.rows[0];
  if (!row || !row.requested_amount_inr || row.requested_amount_inr <= 0) return null;
  if (row.sanctioned_amount_inr === null) return { gapPct: 1, requested: row.requested_amount_inr, sanctioned: null }; // not sanctioned yet — full gap, fails closed
  const gap = Math.max(0, row.requested_amount_inr - row.sanctioned_amount_inr);
  return { gapPct: gap / row.requested_amount_inr, requested: row.requested_amount_inr, sanctioned: row.sanctioned_amount_inr };
}

async function waiverLeakageShare(bookingId: string, consideration: number): Promise<{ share: number; amount: number }> {
  if (consideration <= 0) return { share: 0, amount: 0 };
  const r = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM waiver WHERE booking_id = $1 AND status = 'APPROVED'`,
    [bookingId]
  );
  const amount = r.rows[0]?.total ?? 0;
  return { share: amount / consideration, amount };
}

async function build(bookingId: string, ctx: Ctx): Promise<Built> {
  let value = 100;
  const allDrivers: ScoreDriver[] = [];

  const finance = await bookingFinance(bookingId);

  const trueRisk = await trueRiskShare(bookingId, finance.project_id, finance.consideration);
  if (trueRisk.share > 0) {
    const penalty = Math.round(TRUE_RISK_WEIGHT * Math.min(1, trueRisk.share * 4)); // full weight at 25% true-risk share
    value -= penalty;
    allDrivers.push({ code: "TRUE_RISK_SHARE", label: "True-risk share of receivables", contribution: penalty, fact: `₹${trueRisk.amount.toLocaleString("en-IN")} (${(trueRisk.share * 100).toFixed(1)}%) classified true-risk` });
  }

  const variance = await forecastVariancePct(finance.project_id, ctx);
  if (variance !== null && variance < 0) {
    const penalty = Math.round(VARIANCE_WEIGHT * Math.min(1, Math.abs(variance) * 2)); // full weight at 50% shortfall
    value -= penalty;
    allDrivers.push({ code: "FORECAST_VARIANCE", label: "Forecast variance", contribution: penalty, fact: `project collections ${Math.abs(variance * 100).toFixed(1)}% behind month-start forecast` });
  }

  const loan = await loanGap(bookingId);
  if (loan && loan.gapPct > 0) {
    const penalty = Math.round(LOAN_GAP_WEIGHT * loan.gapPct);
    value -= penalty;
    const fact = loan.sanctioned === null
      ? `loan not yet sanctioned (₹${loan.requested.toLocaleString("en-IN")} requested)`
      : `₹${(loan.requested - loan.sanctioned).toLocaleString("en-IN")} gap between requested and sanctioned`;
    allDrivers.push({ code: "LOAN_GAP", label: "Loan sanction/requirement gap", contribution: penalty, fact });
  }

  const waiver = await waiverLeakageShare(bookingId, finance.consideration);
  if (waiver.share > 0) {
    const penalty = Math.round(WAIVER_WEIGHT * Math.min(1, waiver.share * 10)); // full weight at 10% waived
    value -= penalty;
    allDrivers.push({ code: "WAIVER_LEAKAGE", label: "Waiver leakage", contribution: penalty, fact: `₹${waiver.amount.toLocaleString("en-IN")} (${(waiver.share * 100).toFixed(1)}%) waived` });
  }

  let clearanceBlocked = 0;
  try {
    const clearance = await getClearance(bookingId, "REGISTRATION", ctx);
    clearanceBlocked = clearance.blocked_reasons.length;
  } catch {
    // booking not yet at a registration-clearance-relevant stage — neutral, not a penalty
  }
  if (clearanceBlocked > 0) {
    const penalty = Math.round(CLEARANCE_WEIGHT * Math.min(1, clearanceBlocked / 7));
    value -= penalty;
    allDrivers.push({ code: "CLEARANCE_STATUS", label: "Clearance/NOC status", contribution: penalty, fact: `${clearanceBlocked} registration-clearance item(s) outstanding` });
  }

  return { value: Math.max(0, Math.min(100, value)), allDrivers, projectId: finance.project_id };
}

export async function computeFinancialHealth(bookingId: string, ctx: Ctx): Promise<Score> {
  const { value, allDrivers, projectId } = await build(bookingId, ctx);
  const previous = await previousValue("FINANCIAL_HEALTH", bookingId);
  const score: Score = {
    value,
    trend: trendFrom(value, previous),
    drivers: topDrivers(allDrivers, 3),
    confidence: "MEDIUM",
    confidence_reason: "rule-based composite over 5 named signals — weights and curve shapes are UNCONFIRMED placeholders, no PDF number given",
    actions: [],
  };
  await recordScore("FINANCIAL_HEALTH", "booking", bookingId, projectId, score, previous);
  return score;
}

export async function explainFinancialHealth(bookingId: string, ctx: Ctx): Promise<Score> {
  const { value, allDrivers } = await build(bookingId, ctx);
  const previous = await previousValue("FINANCIAL_HEALTH", bookingId);
  return {
    value,
    trend: trendFrom(value, previous),
    drivers: allDrivers,
    confidence: "MEDIUM",
    confidence_reason: "rule-based composite over 5 named signals — weights and curve shapes are UNCONFIRMED placeholders, no PDF number given",
    actions: [],
  };
}
