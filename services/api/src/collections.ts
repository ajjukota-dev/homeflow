// True-risk collections engine — accounts/spec.md §2.3 + T2 why-now (customer-transparency.md).
// Pure functions: given an open demand's facts + policy threshold, land it in exactly one bucket.
// No project-specific values here — threshold and labels come from data.

import { progressAtLeast, type ProgressState } from "./gates";

export type DemandStatus =
  | "scheduled"
  | "due"
  | "overdue"
  | "part_paid"
  | "settled"
  | "disputed"
  | "waived";

export type RiskBucket =
  | "DUE"
  | "OVERDUE"
  | "DISPUTED"
  | "LOAN_DEPENDENT"
  | "PROMISE_TO_PAY"
  | "TRUE_RISK";

export const RISK_BUCKETS: RiskBucket[] = [
  "DUE",
  "OVERDUE",
  "DISPUTED",
  "LOAN_DEPENDENT",
  "PROMISE_TO_PAY",
  "TRUE_RISK",
];

export interface ClassifyInput {
  remaining: number;
  status: DemandStatus;
  due_date: string | null; // YYYY-MM-DD; null until a construction trigger fires
  as_of: string;
  loan_dependent: boolean;
  has_active_ptp: boolean;
  recovery_probability: number;
  true_risk_threshold: number;
}

const MS_PER_DAY = 86_400_000;

/** Calendar days past due. Zero if as_of is on or before due_date, or due_date isn't set yet. */
export function daysOverdue(dueDate: string | null, asOf: string): number {
  if (dueDate === null) return 0;
  const delta = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return Math.max(0, Math.round(delta / MS_PER_DAY));
}

/** Explainable ageing bands — not a hidden model. Policy Studio can replace this later. */
export function recoveryProbability(days: number): number {
  if (days <= 0) return 1;
  if (days <= 15) return 0.8;
  if (days <= 45) return 0.5;
  return 0.25;
}

function isPastDue(input: ClassifyInput): boolean {
  if (input.status === "overdue") return true;
  return input.due_date !== null && input.due_date < input.as_of;
}

/**
 * Every open rupee lands in exactly one bucket.
 * TRUE_RISK is overdue whose recovery probability is below the project policy threshold,
 * with no active PTP or loan path (accounts/spec.md §2.3).
 */
export function classifyOpenAmount(input: ClassifyInput): RiskBucket | null {
  if (input.remaining <= 0) return null;
  if (input.status === "settled" || input.status === "waived" || input.status === "scheduled") {
    return null;
  }
  if (input.status === "disputed") return "DISPUTED";
  if (input.loan_dependent) return "LOAN_DEPENDENT";
  if (input.has_active_ptp) return "PROMISE_TO_PAY";
  if (isPastDue(input)) {
    if (input.recovery_probability < input.true_risk_threshold) return "TRUE_RISK";
    return "OVERDUE";
  }
  return "DUE";
}

const TRIGGER_NOUN: Record<string, string> = {
  structure: "structure",
  mep_first_fix: "MEP first-fix",
  flooring: "flooring",
  finishing: "finishing",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Customer-safe T2 copy, derived from the unit's ACTUAL component progress —
 * never from the demand's status/trigger name alone (customer-transparency.md §5.2).
 * Never emits internal codes, risk buckets, or a stage the unit hasn't reached.
 */
export function whyNow(input: {
  milestone_label: string;
  construction_trigger_event: string | null;
  status: DemandStatus | string;
  component_state: ProgressState | null;
}): string {
  const trigger = input.construction_trigger_event;
  if (!trigger) return "Booking payment — due.";

  const [component, minState] = trigger.split(":") as [string, ProgressState];
  const noun = TRIGGER_NOUN[component];
  if (!noun) return "Payment due.";

  if (input.status === "scheduled") {
    return `Upcoming — after ${noun} is verified.`;
  }
  const state = input.component_state ?? "not_started";
  if (!progressAtLeast(state, minState)) return "Payment due.";
  return `${capitalize(noun)} ${state.replace(/_/g, " ")} — payment due.`;
}
