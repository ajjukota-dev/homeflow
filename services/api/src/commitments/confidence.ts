// Rule 5's confidence score — pure, framework-free, mirrors loans/risk.ts's own scoring style
// (named drivers, not a hidden model). Computed at read time, never stored (0028's own header).
//
// Scope cut, flagged not faked: `depends_on` can carry ACTION|CHANGE_REQUEST|PROGRESS|DEMAND
// entries per the spec's Data table, but only ACTION (10) and DEMAND (04/19) are real tables this
// codebase can look up today — CHANGE_REQUEST (18) and PROGRESS (07 unit progress control) are
// both unbuilt. A CHANGE_REQUEST/PROGRESS dependency entry is scored neutral (no penalty, no
// bonus) rather than guessed at, since there's no real status to read.

export type DependencyType = "ACTION" | "CHANGE_REQUEST" | "PROGRESS" | "DEMAND";

export interface DependencyFact {
  type: DependencyType;
  /** Only present for ACTION/DEMAND — the types this codebase can actually resolve. */
  resolved?: { blocked: boolean; overdue: boolean; satisfied: boolean };
}

export interface ConfidenceInput {
  dependencies: DependencyFact[];
  ownerOpenCount: number; // count of this owner's other open (ACTIVE/AT_RISK) commitments + actions
  departmentFulfilledCount: number;
  departmentBreachedCount: number;
}

export interface ConfidenceResult {
  score: number; // 0-100
  drivers: { label: string; delta: number }[];
}

const OWNER_LOAD_FREE_ALLOWANCE = 3; // UNCONFIRMED — no client number for "how much load is fine"
const OWNER_LOAD_PENALTY_PER_ITEM = 4;

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const drivers: { label: string; delta: number }[] = [];
  let score = 100;

  for (const dep of input.dependencies) {
    if (!dep.resolved) continue; // CHANGE_REQUEST/PROGRESS — neutral, no data source exists yet
    if (dep.resolved.satisfied) continue;
    if (dep.resolved.blocked) {
      score -= 25;
      drivers.push({ label: `a ${dep.type.toLowerCase()} dependency is blocked`, delta: -25 });
    } else if (dep.resolved.overdue) {
      score -= 15;
      drivers.push({ label: `a ${dep.type.toLowerCase()} dependency is overdue`, delta: -15 });
    }
  }

  const excessLoad = Math.max(0, input.ownerOpenCount - OWNER_LOAD_FREE_ALLOWANCE);
  if (excessLoad > 0) {
    const delta = -Math.min(30, excessLoad * OWNER_LOAD_PENALTY_PER_ITEM);
    score += delta;
    drivers.push({ label: `owner has ${input.ownerOpenCount} other open items`, delta });
  }

  const total = input.departmentFulfilledCount + input.departmentBreachedCount;
  if (total > 0) {
    const rate = input.departmentFulfilledCount / total;
    const delta = Math.round((rate - 1) * 20); // 0 at 100% historical fulfilment, down to -20 at 0%
    if (delta !== 0) {
      score += delta;
      drivers.push({ label: `department's historical fulfilment rate is ${Math.round(rate * 100)}%`, delta });
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), drivers };
}
