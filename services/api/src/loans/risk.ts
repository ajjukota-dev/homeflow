// Loan risk score — 21-loans.md rule 5: "drivers from stage age (application > 15 d), missing
// docs count, validity days left, lender responsiveness (last event age), timing gap; actions
// 'Chase lender', 'Collect <doc>'." Pure function, framework-free, same style as collections.ts's
// classifyOpenAmount/recoveryProbability — explainable ageing bands, not a hidden model.
//
// The spec parenthesizes "(14 contract)" — 14-readiness-scores.md's shared universal ScoreCard
// shape — but 14 isn't built yet (TODO.md R3). This computes the drivers rule 5 names directly,
// deliberately not integrated with 14's contract; revisit once 14 exists (flag, don't fake, same
// treatment 05/06/10 gave their own not-yet-built forward dependencies).
//
// Thresholds: STAGE_AGE (15d) and VALIDITY_WARNING (7d) are real, sourced from
// docs/reference/emergent-business-rules.md §11.1's loan_sanction_delay_15d /
// loan_sanction_validity_expiring_7d rules — not invented. LENDER_UNRESPONSIVE (10d) has no
// literal source in either the spec or the reference doc; picked to sit between the other two,
// and — like them — belongs in 21's own Config section (Policy Studio) once that's wired, not
// hardcoded forever.

export type LoanStage =
  | "APPLICATION"
  | "SANCTION_PENDING"
  | "SANCTIONED"
  | "DOCS_PENDING"
  | "DISBURSEMENT_SCHEDULED"
  | "PARTIALLY_DISBURSED"
  | "FULLY_DISBURSED"
  | "CLOSED"
  | "REJECTED"
  | "WITHDRAWN";

export const STAGE_AGE_THRESHOLD_DAYS = 15;
export const VALIDITY_WARNING_DAYS = 7;
export const LENDER_UNRESPONSIVE_DAYS = 10;

export interface LoanRiskInput {
  stage: LoanStage;
  stage_age_days: number; // days since loan_case.created_at — no per-stage-entry timestamp is tracked (Emergent's own model doesn't track one either, per the reference doc), so this is "age since application", same anchor Emergent's own loan_sanction_delay_15d rule uses
  missing_docs_count: number;
  validity_days_left: number | null; // null when no sanction_validity_date is set, or the loan is FULLY_DISBURSED (rule 4: validity stops mattering once fully disbursed)
  days_since_last_event: number | null; // null when no loan_event exists yet
  timing_gap_days: number | null; // days_to_demand - days_to_disbursement (rule 3); null when either side is unknown
}

export interface LoanRiskDriver {
  code: string;
  label: string;
  points: number;
}

export interface LoanRiskResult {
  score: number; // 0-100, higher = riskier
  drivers: LoanRiskDriver[];
  suggested_actions: string[];
}

const EARLY_STAGES: LoanStage[] = ["APPLICATION", "SANCTION_PENDING"];

export function computeLoanRisk(input: LoanRiskInput): LoanRiskResult {
  const drivers: LoanRiskDriver[] = [];
  const actions: string[] = [];

  if (EARLY_STAGES.includes(input.stage) && input.stage_age_days > STAGE_AGE_THRESHOLD_DAYS) {
    drivers.push({
      code: "STAGE_STALLED",
      label: `${input.stage} for ${input.stage_age_days} day(s)`,
      points: 25,
    });
    actions.push("Chase lender");
  }

  if (input.missing_docs_count > 0) {
    drivers.push({
      code: "MISSING_DOCS",
      label: `${input.missing_docs_count} document(s) missing`,
      points: Math.min(30, input.missing_docs_count * 10),
    });
    actions.push("Collect missing documents");
  }

  if (input.validity_days_left !== null && input.validity_days_left <= VALIDITY_WARNING_DAYS) {
    const expired = input.validity_days_left < 0;
    drivers.push({
      code: expired ? "SANCTION_EXPIRED" : "VALIDITY_EXPIRING",
      label: expired ? "Sanction validity has expired" : `Sanction validity expires in ${input.validity_days_left} day(s)`,
      points: expired ? 40 : 20,
    });
    actions.push(expired ? "Renew sanction" : "Expedite disbursement before validity expires");
  }

  if (input.days_since_last_event !== null && input.days_since_last_event > LENDER_UNRESPONSIVE_DAYS) {
    drivers.push({
      code: "LENDER_UNRESPONSIVE",
      label: `No lender activity for ${input.days_since_last_event} day(s)`,
      points: 15,
    });
    actions.push("Chase lender");
  }

  if (input.timing_gap_days !== null && input.timing_gap_days < 0) {
    drivers.push({
      code: "TIMING_GAP",
      label: `Next demand due ${Math.abs(input.timing_gap_days)} day(s) before expected disbursement`,
      points: 20,
    });
    actions.push("Expedite disbursement");
  }

  const score = Math.min(100, drivers.reduce((sum, d) => sum + d.points, 0));
  return { score, drivers, suggested_actions: [...new Set(actions)] };
}
