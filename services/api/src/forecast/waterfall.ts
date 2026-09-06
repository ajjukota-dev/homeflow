// 20-cash-forecast.md rule 4 — pure, framework-free (mirrors gates.ts/risk.ts's own style).
// "opening outstanding -> + demands raised -> expected (weighted) -> + overdue recovery ->
// + loan inflow -> - shortfall (expected - target) -> closing outstanding" is a running-balance
// table, not a single formula — read as: raw new demand amounts increase outstanding; the three
// weighted collection categories (expected/overdue/loan) reduce it; shortfall vs target and
// confidence are informational columns alongside, not inputs to the balance itself.
//
// Advisor review (pre-build): `cash_target` ships with zero seeded rows (CLAUDE.md "never
// hard-code East Crest values", same call as 25's approval bands). Defaulting an unset target to
// 0 would report a fake surplus equal to the full expected collection every period — worse than
// no number at all. `target_inr`/`shortfall` are therefore `null`, not 0, whenever no target
// covers a period; callers must render "no target set", never treat null as zero.

import type { ForecastSourceType } from "./probability";

export interface WaterfallLine {
  source_type: ForecastSourceType;
  amount_inr: number;
  probability: number;
}

export interface WaterfallPeriodInput {
  period: string; // YYYY-MM
  lines: WaterfallLine[];
  target_inr: number | null;
}

export interface WaterfallInput {
  opening_outstanding: number;
  periods: WaterfallPeriodInput[]; // must be in chronological order
}

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export interface WaterfallPeriodResult {
  period: string;
  opening_outstanding: number;
  demands_raised: number; // raw (unweighted) sum of every line landing this period
  expected_weighted: number; // CONTRACTUAL_DUE + PROMISE_TO_PAY + REGISTRATION_FINAL_DEMAND + MANUAL_FINANCE_OVERRIDE + SCENARIO_FUTURE_SALES, probability-weighted
  overdue_recovery_weighted: number;
  loan_inflow_weighted: number;
  target_inr: number | null;
  shortfall: number | null; // (expected_weighted + overdue_recovery_weighted + loan_inflow_weighted) - target_inr; null if no target
  closing_outstanding: number;
  confidence: Confidence;
}

const OVERDUE: ForecastSourceType = "OVERDUE_RECOVERY";
const LOAN: ForecastSourceType = "LOAN_DISBURSEMENT";

function bucketOf(sourceType: ForecastSourceType): "expected" | "overdue" | "loan" {
  if (sourceType === OVERDUE) return "overdue";
  if (sourceType === LOAN) return "loan";
  return "expected";
}

/** Amount-weighted average probability, banded into the same LOW/MEDIUM/HIGH vocabulary already
 *  used by registration_case.forecast_confidence and handover's predicted_confidence — a real
 *  dispersion statistic (variance across lines) would need a client-set threshold this codebase
 *  has no source for; banding the weighted mean is the simpler, already-established idiom. */
export function bandConfidence(lines: WaterfallLine[]): Confidence {
  const totalAmount = lines.reduce((s, l) => s + l.amount_inr, 0);
  if (totalAmount <= 0) return "LOW";
  const weightedMean = lines.reduce((s, l) => s + l.amount_inr * l.probability, 0) / totalAmount;
  if (weightedMean >= 0.8) return "HIGH";
  if (weightedMean >= 0.5) return "MEDIUM";
  return "LOW";
}

export function computeWaterfall(input: WaterfallInput): WaterfallPeriodResult[] {
  const results: WaterfallPeriodResult[] = [];
  let opening = input.opening_outstanding;

  for (const p of input.periods) {
    const demandsRaised = p.lines.reduce((s, l) => s + l.amount_inr, 0);
    let expected = 0;
    let overdue = 0;
    let loan = 0;
    for (const l of p.lines) {
      const weighted = l.amount_inr * l.probability;
      const bucket = bucketOf(l.source_type);
      if (bucket === "expected") expected += weighted;
      else if (bucket === "overdue") overdue += weighted;
      else loan += weighted;
    }
    const totalWeighted = expected + overdue + loan;
    const shortfall = p.target_inr === null ? null : totalWeighted - p.target_inr;
    const closing = opening + demandsRaised - totalWeighted;

    results.push({
      period: p.period,
      opening_outstanding: opening,
      demands_raised: demandsRaised,
      expected_weighted: expected,
      overdue_recovery_weighted: overdue,
      loan_inflow_weighted: loan,
      target_inr: p.target_inr,
      shortfall,
      closing_outstanding: closing,
      confidence: bandConfidence(p.lines),
    });
    opening = closing;
  }
  return results;
}
