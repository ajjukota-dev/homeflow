// 20-cash-forecast.md rule 2 — probability, rule-based and explainable (p10; p8 §6). Pure,
// framework-free (CLAUDE.md "Explicit boundaries"). Values are the spec's own Data-row seed,
// marked DEFAULT_UNCONFIRMED there — real numbers need Amarsh, same class as 12/13's ladder
// hours and materiality thresholds.
//
// `condition` (age band, reason category, loan stage, customer health band) is stored on
// `probability_rule` for Policy Studio editing, but only age band and loan stage actually drive
// today's probability computation — reason category has no real source (`overdue_reason` has no
// category column, only code/label/next_action) and "customer health band" has no scoring source
// anywhere in this codebase (14's readiness scores don't cover it). Both still appear in
// `probability_drivers` as explanatory facts (the spec's own "Overdue 22d · reason: loan delay ·
// customer paid late twice" example is a display string, not a second probability input) — flagged
// here, not silently dropped from the explain output.

export type ForecastSourceType =
  | "CONTRACTUAL_DUE"
  | "OVERDUE_RECOVERY"
  | "PROMISE_TO_PAY"
  | "LOAN_DISBURSEMENT"
  | "REGISTRATION_FINAL_DEMAND"
  | "APPROVED_RESCHEDULE"
  | "MANUAL_FINANCE_OVERRIDE"
  | "SCENARIO_FUTURE_SALES";

export interface ProbabilityDriver {
  label: string;
  value: string;
}

export interface ProbabilityResult {
  probability: number;
  drivers: ProbabilityDriver[]; // at most 3, per the Data row's `probability_drivers jsonb [3]`
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Overdue-age bands, DEFAULT_UNCONFIRMED (spec's own seed row): 0-15d 0.6, 16-45d 0.4,
 *  46-90d 0.25, >90d 0.1. Boundaries are ours (the spec gives four values, not four boundaries). */
export function overdueRecoveryProbability(daysOverdue: number): number {
  if (daysOverdue <= 15) return 0.6;
  if (daysOverdue <= 45) return 0.4;
  if (daysOverdue <= 90) return 0.25;
  return 0.1;
}

/** Rule: "PROMISE_TO_PAY 0.7 (× historical honour rate)" — mirrors commitments/confidence.ts's
 *  own "compute a rate from history, neutral when n is too small" shape. Neutral here means
 *  honourRate=1 (no penalty applied), not 0 — an untested customer isn't assumed to be a risk. */
export function ptpHonourRate(honouredCount: number, totalCount: number): number {
  if (totalCount <= 0) return 1;
  return honouredCount / totalCount;
}

/** Rule: "LOAN_DISBURSEMENT by stage 0.9 sanctioned / 0.5 applied." Loan stages beyond
 *  SANCTIONED (docs/disbursement in progress) count as "sanctioned or later" for this purpose —
 *  the spec's two-value list doesn't itemise every one of 21's 10 stages, so anything at or past
 *  SANCTIONED gets the higher figure, anything before it gets the lower. */
const LOAN_SANCTIONED_OR_LATER = new Set([
  "SANCTIONED",
  "DOCS_PENDING",
  "DISBURSEMENT_SCHEDULED",
  "PARTIALLY_DISBURSED",
  "FULLY_DISBURSED",
]);

export function loanDisbursementProbability(stage: string): number {
  return LOAN_SANCTIONED_OR_LATER.has(stage) ? 0.9 : 0.5;
}

export interface ProbabilityInput {
  source_type: ForecastSourceType;
  contractualDue?: { everLate: boolean };
  overdueRecovery?: { daysOverdue: number; reasonLabel: string | null };
  promiseToPay?: { honouredCount: number; totalCount: number };
  loanDisbursement?: { stage: string };
  manualOverride?: { probability: number };
}

/** Central dispatch — one call site per derived line in derive.ts, so a future Policy Studio
 *  edit to probability_rule has exactly one place to eventually read from instead of the
 *  in-code constants above (not built — see this module's header). */
export function computeProbability(input: ProbabilityInput): ProbabilityResult {
  switch (input.source_type) {
    case "CONTRACTUAL_DUE": {
      const everLate = input.contractualDue?.everLate ?? false;
      return {
        probability: everLate ? 0.85 : 0.95,
        drivers: [{ label: "payment history", value: everLate ? "has paid late before" : "never late" }],
      };
    }
    case "OVERDUE_RECOVERY": {
      const days = input.overdueRecovery?.daysOverdue ?? 0;
      const drivers: ProbabilityDriver[] = [{ label: "overdue", value: `${days} d` }];
      if (input.overdueRecovery?.reasonLabel) drivers.push({ label: "reason", value: input.overdueRecovery.reasonLabel });
      return { probability: overdueRecoveryProbability(days), drivers };
    }
    case "PROMISE_TO_PAY": {
      const honoured = input.promiseToPay?.honouredCount ?? 0;
      const total = input.promiseToPay?.totalCount ?? 0;
      const rate = ptpHonourRate(honoured, total);
      return {
        probability: clamp01(0.7 * rate),
        drivers: [{ label: "historical honour rate", value: total > 0 ? `${honoured}/${total} past promises kept` : "no history — neutral" }],
      };
    }
    case "LOAN_DISBURSEMENT": {
      const stage = input.loanDisbursement?.stage ?? "APPLICATION";
      return { probability: loanDisbursementProbability(stage), drivers: [{ label: "loan stage", value: stage }] };
    }
    case "APPROVED_RESCHEDULE":
      return { probability: 0.8, drivers: [{ label: "source", value: "approved plan reschedule" }] };
    case "MANUAL_FINANCE_OVERRIDE": {
      const p = clamp01(input.manualOverride?.probability ?? 1);
      return { probability: p, drivers: [{ label: "source", value: "manual override" }] };
    }
    // Not in the spec's own probability_rule seed list (only 6 of 8 source types are named there)
    // — flagged, not guessed: REGISTRATION_FINAL_DEMAND lines are only ever derived once
    // registration has actually executed (see derive.ts), so they carry certainty (1), not a
    // forward-looking estimate. SCENARIO_FUTURE_SALES represents an assumed number chosen by the
    // scenario itself (rule 5) — its uncertainty is expressed by which scenario you pick, not a
    // further probability weighting, so it also carries 1 within its own scenario.
    case "REGISTRATION_FINAL_DEMAND":
      return { probability: 1, drivers: [{ label: "source", value: "registration executed" }] };
    case "SCENARIO_FUTURE_SALES":
      return { probability: 1, drivers: [{ label: "source", value: "scenario assumption" }] };
  }
}
