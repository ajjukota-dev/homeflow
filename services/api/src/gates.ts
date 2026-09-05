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

export type TriggerEvent = "PROCUREMENT_ORDERED" | "DRAWING_RELEASED" | "SLAB_CAST" | "HANDOVER_SCHEDULED";

export interface ChangeGateRule {
  category_code: string;
  trigger_component_code: string;
  min_state: ProgressState | null; // rule applies once the trigger component reaches ≥ this state
  resulting_state: GateState;
  // 08-changeability-engine.md additions — every field optional so the pre-08 callers and the
  // seeded rule shape keep working unchanged.
  id?: number;
  code?: string | null;
  trigger_event?: TriggerEvent | null; // alternative to min_state for non-progress triggers
  hard_or_soft?: "HARD" | "SOFT";
  closing_lead_days?: number;
  exception_authority_role?: string;
  priority?: number;
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
    if (rule.min_state === null) continue; // event-triggered rules need evaluateGates' inputs
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

// ---------------------------------------------------------------------------------------------
// 08-changeability-engine.md rules 1, 2, 4, 9 — the full engine, still pure. `deriveGate` above
// stays as the pre-08 entry point (customer.ts, gate-inputs.ts) and agrees with this one for
// progress-only rules; this adds event triggers, priority, CLOSING-by-forecast and freshness.

export interface GateComponentInput {
  state: ProgressState;
  /** 07's forecast for the component's next event — drives rule 2's CLOSING window. */
  planned_next_event_date?: string | null;
  /** 07's live freshness of the reading — drives rule 4. */
  freshness?: "FRESH" | "STALE" | "VERIFICATION_REQUIRED";
}

export interface GateCategoryInput {
  code: string;
  customer_visible: boolean;
  weight: number;
}

export interface GateEvaluationInput {
  components: Record<string, GateComponentInput>;
  /** Non-progress trigger events already observed for the unit (rule 1's `trigger_event`). */
  events: TriggerEvent[];
  rules: ChangeGateRule[];
  /** ISO date (YYYY-MM-DD) the CLOSING window is measured from. */
  asOf: string;
}

export interface EvaluatedGate {
  category_code: string;
  state: GateState;
  reason_code: string | null;
  reason_text: string;
  rule_id: number | null;
  expected_close_at: string | null;
  closing_event: string | null;
  freshness_status: "FRESH" | "VERIFICATION_REQUIRED";
  exception_authority_role: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function satisfied(rule: ChangeGateRule, input: GateEvaluationInput): boolean {
  if (rule.trigger_event) return input.events.includes(rule.trigger_event);
  if (rule.min_state === null) return false;
  const current = input.components[rule.trigger_component_code]?.state ?? "not_started";
  return progressRank[current] >= progressRank[rule.min_state];
}

/** Rule 1's tie-break: HARD_CLOSED beats everything, then the most restrictive state, then priority. */
function moreRestrictive(a: ChangeGateRule, b: ChangeGateRule | null): boolean {
  if (!b) return true;
  if (a.resulting_state === "HARD_CLOSED" && b.resulting_state !== "HARD_CLOSED") return true;
  if (b.resulting_state === "HARD_CLOSED" && a.resulting_state !== "HARD_CLOSED") return false;
  if (gateRank[a.resulting_state] !== gateRank[b.resulting_state]) return gateRank[a.resulting_state] > gateRank[b.resulting_state];
  return (a.priority ?? 0) > (b.priority ?? 0);
}

/** Rule 1 + 2 + 4 for one category. Pure. */
export function evaluateCategory(categoryCode: string, input: GateEvaluationInput): EvaluatedGate {
  const rules = input.rules.filter((r) => r.category_code === categoryCode);
  let winner: ChangeGateRule | null = null;
  for (const rule of rules) {
    if (satisfied(rule, input) && moreRestrictive(rule, winner)) winner = rule;
  }

  let state: GateState = winner?.resulting_state ?? "OPEN";
  let reasonText = "No closing event yet";
  let expectedCloseAt: string | null = null;
  let closingEvent: string | null = null;
  if (winner) {
    const c = input.components[winner.trigger_component_code];
    reasonText = winner.trigger_event
      ? `${winner.trigger_event} observed`
      : `${winner.trigger_component_code} reached ${c?.state ?? "not_started"}`;
  }

  // Rule 2: a not-yet-satisfied progress rule whose trigger component is forecast to reach its
  // event within closing_lead_days → CLOSING with the forecast date (only if that's more
  // restrictive than what's already derived).
  if (gateRank[state] < gateRank.CLOSING) {
    const asOfMs = Date.parse(input.asOf);
    for (const rule of rules) {
      if (rule.trigger_event || rule.min_state === null || satisfied(rule, input)) continue;
      const forecast = input.components[rule.trigger_component_code]?.planned_next_event_date;
      if (!forecast) continue;
      const daysAway = (Date.parse(forecast) - asOfMs) / DAY_MS;
      if (daysAway <= (rule.closing_lead_days ?? 0) && (expectedCloseAt === null || forecast < expectedCloseAt)) {
        state = "CLOSING";
        expectedCloseAt = forecast;
        closingEvent = `${rule.trigger_component_code} ${rule.min_state}`;
        reasonText = `${rule.trigger_component_code} forecast ${rule.min_state} on ${forecast}`;
        winner = rule;
      }
    }
  }

  // Rule 4: a stale trigger reading taints the gate — surfaced as VERIFICATION_REQUIRED, never OPEN.
  const triggerCodes = new Set(rules.filter((r) => !r.trigger_event).map((r) => r.trigger_component_code));
  const stale = [...triggerCodes].some((code) => {
    const f = input.components[code]?.freshness;
    return f === "STALE" || f === "VERIFICATION_REQUIRED";
  });

  return {
    category_code: categoryCode,
    state,
    reason_code: winner?.code ?? null,
    reason_text: reasonText,
    rule_id: winner?.id ?? null,
    expected_close_at: expectedCloseAt,
    closing_event: closingEvent,
    freshness_status: stale ? "VERIFICATION_REQUIRED" : "FRESH",
    exception_authority_role: winner?.exception_authority_role ?? null,
  };
}

export function evaluateGates(categories: GateCategoryInput[], input: GateEvaluationInput): EvaluatedGate[] {
  return categories.map((c) => evaluateCategory(c.code, input));
}

const flexibilityShare: Record<GateState, number> = { OPEN: 1, CLOSING: 0.5, CONDITIONAL: 0.5, EXCEPTION_ONLY: 0, HARD_CLOSED: 0 };

/** Rule 9: weighted share of customer-visible categories still changeable, 0–100. */
export function flexibilityScore(gates: EvaluatedGate[], categories: GateCategoryInput[]): { value: number; drivers: { category_code: string; state: GateState; weight: number; lost: number; reason: string }[] } {
  const visible = categories.filter((c) => c.customer_visible);
  const totalWeight = visible.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return { value: 0, drivers: [] };
  let earned = 0;
  const drivers: { category_code: string; state: GateState; weight: number; lost: number; reason: string }[] = [];
  for (const c of visible) {
    const g = gates.find((x) => x.category_code === c.code);
    const share = g ? flexibilityShare[g.state] : 1;
    earned += c.weight * share;
    if (g && share < 1) drivers.push({ category_code: c.code, state: g.state, weight: c.weight, lost: Math.round((c.weight * (1 - share) * 100) / totalWeight), reason: g.reason_text });
  }
  return { value: Math.round((earned / totalWeight) * 100), drivers: drivers.sort((a, b) => b.lost - a.lost) };
}
