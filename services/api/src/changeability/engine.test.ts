import { describe, it, expect } from "vitest";
import { evaluateCategory, evaluateGates, flexibilityScore, type ChangeGateRule, type GateEvaluationInput, type ProgressState, type GateState } from "../gates";

// 08-changeability-engine.md — pure engine table (acceptance: "≥30 rule/progress combinations")
// plus rules 1, 2, 4, 9 on the seeded rule shape (seed.ts) with 08's columns filled in.

const RULES: ChangeGateRule[] = [
  { id: 1, code: "electrical:mep_first_fix>=in_progress", category_code: "electrical", trigger_component_code: "mep_first_fix", min_state: "in_progress", resulting_state: "CLOSING", closing_lead_days: 14, exception_authority_role: "MANAGEMENT" },
  { id: 2, code: "electrical:mep_first_fix>=complete", category_code: "electrical", trigger_component_code: "mep_first_fix", min_state: "complete", resulting_state: "EXCEPTION_ONLY", closing_lead_days: 14, exception_authority_role: "MANAGEMENT" },
  { id: 3, code: "kitchen_layout:mep_first_fix>=in_progress", category_code: "kitchen_layout", trigger_component_code: "mep_first_fix", min_state: "in_progress", resulting_state: "CONDITIONAL", closing_lead_days: 14 },
  { id: 4, code: "kitchen_layout:mep_first_fix>=complete", category_code: "kitchen_layout", trigger_component_code: "mep_first_fix", min_state: "complete", resulting_state: "EXCEPTION_ONLY", closing_lead_days: 14 },
  { id: 5, code: "flooring_selection:flooring>=in_progress", category_code: "flooring_selection", trigger_component_code: "flooring", min_state: "in_progress", resulting_state: "CONDITIONAL", closing_lead_days: 14 },
  { id: 6, code: "flooring_selection:flooring>=complete", category_code: "flooring_selection", trigger_component_code: "flooring", min_state: "complete", resulting_state: "EXCEPTION_ONLY", closing_lead_days: 14 },
  { id: 7, code: "structural:structure>=complete", category_code: "structural", trigger_component_code: "structure", min_state: "complete", resulting_state: "HARD_CLOSED", closing_lead_days: 30 },
];

const CATEGORIES = [
  { code: "kitchen_layout", customer_visible: true, weight: 1 },
  { code: "electrical", customer_visible: true, weight: 1 },
  { code: "flooring_selection", customer_visible: true, weight: 1 },
  { code: "structural", customer_visible: false, weight: 1 },
];

const input = (components: Record<string, ProgressState>, extra: Partial<GateEvaluationInput> = {}): GateEvaluationInput => ({
  components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, { state: v }])),
  events: [],
  rules: RULES,
  asOf: "2026-09-06",
  ...extra,
});

const STATES: ProgressState[] = ["not_started", "in_progress", "rework", "complete", "verified"];

describe("engine table — every category × every trigger progress state (rule 1)", () => {
  const expected: Record<string, Record<ProgressState, GateState>> = {
    electrical: { not_started: "OPEN", in_progress: "CLOSING", rework: "CLOSING", complete: "EXCEPTION_ONLY", verified: "EXCEPTION_ONLY" },
    kitchen_layout: { not_started: "OPEN", in_progress: "CONDITIONAL", rework: "CONDITIONAL", complete: "EXCEPTION_ONLY", verified: "EXCEPTION_ONLY" },
    flooring_selection: { not_started: "OPEN", in_progress: "CONDITIONAL", rework: "CONDITIONAL", complete: "EXCEPTION_ONLY", verified: "EXCEPTION_ONLY" },
    structural: { not_started: "OPEN", in_progress: "OPEN", rework: "OPEN", complete: "HARD_CLOSED", verified: "HARD_CLOSED" },
  };
  const trigger: Record<string, string> = { electrical: "mep_first_fix", kitchen_layout: "mep_first_fix", flooring_selection: "flooring", structural: "structure" };
  const table = Object.keys(expected).flatMap((cat) => STATES.map((s) => [cat, s, expected[cat]![s]] as const));

  it.each(table)("%s with %s → %s", (cat, state, want) => {
    const g = evaluateCategory(cat, input({ [trigger[cat]!]: state }));
    expect(g.state).toBe(want);
    if (want === "OPEN") expect(g.rule_id).toBeNull();
    else expect(g.reason_text).toContain(trigger[cat]!);
  });

  it("an unrelated component never moves the gate (10 more combinations)", () => {
    for (const s of STATES) {
      expect(evaluateCategory("structural", input({ mep_first_fix: s, flooring: s })).state).toBe("OPEN");
      expect(evaluateCategory("electrical", input({ structure: s, flooring: s })).state).toBe("OPEN");
    }
  });
});

describe("rule 1 — HARD_CLOSED beats everything, priority breaks ties, event triggers", () => {
  it("a HARD_CLOSED rule wins over a higher-priority EXCEPTION_ONLY rule on the same category", () => {
    const rules: ChangeGateRule[] = [
      { id: 10, code: "a", category_code: "x", trigger_component_code: "c", min_state: "complete", resulting_state: "EXCEPTION_ONLY", priority: 99 },
      { id: 11, code: "b", category_code: "x", trigger_component_code: "c", min_state: "complete", resulting_state: "HARD_CLOSED", priority: 0 },
    ];
    expect(evaluateCategory("x", input({ c: "complete" }, { rules }))).toMatchObject({ state: "HARD_CLOSED", rule_id: 11, reason_code: "b" });
  });
  it("same resulting state: the higher priority rule is the source", () => {
    const rules: ChangeGateRule[] = [
      { id: 20, code: "low", category_code: "x", trigger_component_code: "c", min_state: "in_progress", resulting_state: "CONDITIONAL", priority: 1 },
      { id: 21, code: "high", category_code: "x", trigger_component_code: "c", min_state: "in_progress", resulting_state: "CONDITIONAL", priority: 5 },
    ];
    expect(evaluateCategory("x", input({ c: "in_progress" }, { rules })).reason_code).toBe("high");
  });
  it("an event-triggered rule fires only once the event is observed", () => {
    const rules: ChangeGateRule[] = [{ id: 30, code: "ho", category_code: "x", trigger_component_code: "finishing", min_state: null, trigger_event: "HANDOVER_SCHEDULED", resulting_state: "HARD_CLOSED" }];
    expect(evaluateCategory("x", input({}, { rules })).state).toBe("OPEN");
    expect(evaluateCategory("x", input({}, { rules, events: ["HANDOVER_SCHEDULED"] }))).toMatchObject({ state: "HARD_CLOSED", reason_text: "HANDOVER_SCHEDULED observed" });
  });
});

describe("rule 2 — CLOSING from the forecast", () => {
  it("a trigger forecast within closing_lead_days derives CLOSING with expected_close_at; outside the window stays OPEN", () => {
    const soon = evaluateCategory("electrical", { ...input({}), components: { mep_first_fix: { state: "not_started", planned_next_event_date: "2026-09-15" } } });
    expect(soon).toMatchObject({ state: "CLOSING", expected_close_at: "2026-09-15", closing_event: "mep_first_fix in_progress" });
    const far = evaluateCategory("electrical", { ...input({}), components: { mep_first_fix: { state: "not_started", planned_next_event_date: "2026-12-01" } } });
    expect(far).toMatchObject({ state: "OPEN", expected_close_at: null });
  });
  it("never downgrades an already more-restrictive derived state", () => {
    const g = evaluateCategory("electrical", { ...input({}), components: { mep_first_fix: { state: "complete", planned_next_event_date: "2026-09-08" } } });
    expect(g.state).toBe("EXCEPTION_ONLY");
  });
});

describe("rule 4 — stale trigger reading → VERIFICATION_REQUIRED, never a clean OPEN", () => {
  it("flags the gate when any of its trigger components is STALE or VERIFICATION_REQUIRED", () => {
    const g = evaluateCategory("electrical", { ...input({}), components: { mep_first_fix: { state: "in_progress", freshness: "VERIFICATION_REQUIRED" } } });
    expect(g).toMatchObject({ state: "CLOSING", freshness_status: "VERIFICATION_REQUIRED" });
    const fresh = evaluateCategory("electrical", { ...input({}), components: { mep_first_fix: { state: "in_progress", freshness: "FRESH" } } });
    expect(fresh.freshness_status).toBe("FRESH");
    // a stale component that no rule of this category depends on does not taint it
    const other = evaluateCategory("structural", { ...input({}), components: { mep_first_fix: { state: "in_progress", freshness: "STALE" }, structure: { state: "not_started" } } });
    expect(other.freshness_status).toBe("FRESH");
  });
});

describe("rule 9 — Unit Customisation Flexibility", () => {
  it("weighted share of customer-visible categories: OPEN 1.0, CLOSING/CONDITIONAL 0.5, closed 0; structural (not visible) is ignored", () => {
    const all = evaluateGates(CATEGORIES, input({}));
    expect(flexibilityScore(all, CATEGORIES).value).toBe(100);
    const mid = evaluateGates(CATEGORIES, input({ mep_first_fix: "in_progress", structure: "complete" }));
    const f = flexibilityScore(mid, CATEGORIES);
    expect(f.value).toBe(67); // (0.5 + 0.5 + 1) / 3
    expect(f.drivers.map((d) => d.category_code).sort()).toEqual(["electrical", "kitchen_layout"]);
    const closed = evaluateGates(CATEGORIES, input({ mep_first_fix: "complete", flooring: "complete" }));
    expect(flexibilityScore(closed, CATEGORIES).value).toBe(0);
    const weighted = flexibilityScore(mid, CATEGORIES.map((c) => (c.code === "flooring_selection" ? { ...c, weight: 3 } : c)));
    expect(weighted.value).toBe(80); // (0.5 + 0.5 + 3) / 5
  });
});
