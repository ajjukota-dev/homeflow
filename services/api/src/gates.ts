// Changeability gate engine — foundation/gates.md §A.3.
// Pure functions: given a unit's component progress + configured rules, derive the
// per-category gate state. No hard-coded units here — everything comes from data.

export type ProgressState = "not_started" | "in_progress" | "complete" | "verified" | "rework";
export type GateState = "OPEN" | "CLOSING" | "CONDITIONAL" | "EXCEPTION_ONLY" | "HARD_CLOSED";

// rework (07 rule 3: VERIFIED → REWORK) ranks with in_progress — physically the work is open
// again, so a gate that closed on "complete" reopens. UNCONFIRMED until 08 owns gate semantics.
const progressRank: Record<ProgressState, number> = {
  not_started: 0,
  in_progress: 1,
  rework: 1,
  complete: 2,
  verified: 3,
};

export function progressAtLeast(current: ProgressState, min: ProgressState): boolean {
  return progressRank[current] >= progressRank[min];
}

const gateRank: Record<GateState, number> = {
  OPEN: 0,
  CLOSING: 1,
  CONDITIONAL: 2,
  EXCEPTION_ONLY: 3,
  HARD_CLOSED: 4,
};

const gateScore: Record<GateState, number> = {
  OPEN: 100,
  CLOSING: 72,
  CONDITIONAL: 55,
  EXCEPTION_ONLY: 20,
  HARD_CLOSED: 5,
};

export interface ChangeGateRule {
  category_code: string;
  trigger_component_code: string;
  min_state: ProgressState; // rule applies once the trigger component reaches ≥ this state
  resulting_state: GateState;
}

/** Derive one category's gate from the unit's progress + the rules for that category.
 *  Most-restrictive satisfied rule wins; default OPEN. */
export function deriveGate(
  categoryCode: string,
  progress: Record<string, ProgressState>,
  rules: ChangeGateRule[]
): { state: GateState; reason: string } {
  let winner: GateState = "OPEN";
  let reason = "No closing event yet";
  for (const rule of rules) {
    if (rule.category_code !== categoryCode) continue;
    const current = progress[rule.trigger_component_code] ?? "not_started";
    if (progressRank[current] >= progressRank[rule.min_state]) {
      if (gateRank[rule.resulting_state] > gateRank[winner]) {
        winner = rule.resulting_state;
        reason = `${rule.trigger_component_code} reached ${current}`;
      }
    }
  }
  return { state: winner, reason };
}

/** Changeability score 0–100 = average of category gate scores (explainable). */
export function changeabilityScore(states: GateState[]): number {
  if (states.length === 0) return 0;
  const sum = states.reduce((a, s) => a + gateScore[s], 0);
  return Math.round(sum / states.length);
}
