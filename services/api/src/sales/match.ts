import type { GateState, ProgressState } from "../gates";

// 24-sales-inventory-discovery.md rules 1 (thresholds), 4 (requirement match) and the inventory
// derivations (construction %, possession window). Pure, framework-free.

export type Importance = "MUST_HAVE" | "PREFERRED" | "NOT_IMPORTANT";
export type Verdict = "OPEN" | "CLOSING" | "CONDITIONAL" | "NOT_POSSIBLE";

export interface MatchPolicy {
  match_weights: Record<Importance, number>;
  state_values: Record<GateState, number>;
  must_have_hard_closed_cap: number;
}

export interface MatchGate {
  category_code: string;
  customer_label: string;
  state: GateState;
  reason_text: string;
  expected_close_at: string | null;
  freshness_status: "FRESH" | "VERIFICATION_REQUIRED";
}

export interface MatchNeed { category_code: string; importance: Importance; note?: string | null }

export interface MatchExplanation { category: string; importance: Importance; gate_state: GateState; verdict: Verdict; text: string }

export const MATCH_DISCLAIMER = "Compatibility reflects current site status and is not an engineering approval.";

const verdictFor = (state: GateState): Verdict =>
  state === "OPEN" ? "OPEN" : state === "CLOSING" ? "CLOSING" : state === "CONDITIONAL" ? "CONDITIONAL" : "NOT_POSSIBLE";

function sentence(gate: MatchGate): string {
  const label = gate.customer_label;
  switch (gate.state) {
    case "OPEN":
      return `${label} changes are open (${gate.reason_text.toLowerCase()}).`;
    case "CLOSING":
      return gate.expected_close_at ? `${label} changes are open until ~${gate.expected_close_at} (${gate.reason_text.toLowerCase()}).` : `${label} changes are closing soon (${gate.reason_text.toLowerCase()}).`;
    case "CONDITIONAL":
      return `${label} changes are possible with review (${gate.reason_text.toLowerCase()}).`;
    case "EXCEPTION_ONLY":
      return `${label} changes need a management exception (${gate.reason_text.toLowerCase()}).`;
    default:
      return `${label} changes are closed — ${gate.reason_text.toLowerCase()}.`;
  }
}

/** Rule 4. Needs on categories the unit has no gate for are scored as OPEN (nothing closes them). */
export function computeMatch(needs: MatchNeed[], gates: MatchGate[], policy: MatchPolicy): { score: number; explanation: MatchExplanation[]; disclaimer: string; stale_inputs: boolean } {
  let weighted = 0;
  let totalWeight = 0;
  let capped = false;
  const explanation: MatchExplanation[] = [];
  for (const need of needs) {
    const weight = policy.match_weights[need.importance] ?? 0;
    const gate = gates.find((g) => g.category_code === need.category_code);
    const state: GateState = gate?.state ?? "OPEN";
    totalWeight += weight;
    weighted += weight * (policy.state_values[state] ?? 0);
    if (need.importance === "MUST_HAVE" && state === "HARD_CLOSED") capped = true;
    explanation.push({
      category: need.category_code,
      importance: need.importance,
      gate_state: state,
      verdict: verdictFor(state),
      text: gate ? sentence(gate) : `${need.category_code} has no closing rule on this unit — open.`,
    });
  }
  let score = totalWeight === 0 ? 100 : Math.round((weighted / totalWeight) * 100);
  if (capped) score = Math.min(score, policy.must_have_hard_closed_cap);
  return { score, explanation, disclaimer: MATCH_DISCLAIMER, stale_inputs: gates.some((g) => g.freshness_status === "VERIFICATION_REQUIRED") };
}

const progressShare: Record<ProgressState, number> = { not_started: 0, in_progress: 0.5, rework: 0.5, complete: 1, verified: 1 };

/** Construction % = weighted mean of component progress (pct when 07 recorded one, else the state's share). */
export function constructionPct(components: { state: ProgressState; pct: number | null; weight: number }[]): number {
  const total = components.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return 0;
  const done = components.reduce((s, c) => s + c.weight * (c.pct !== null ? c.pct / 100 : progressShare[c.state]), 0);
  return Math.round((done / total) * 100);
}

export interface PossessionWindow { from: string; to: string; anchor: string; confidence: "HIGH" | "MEDIUM" | "LOW"; basis: string }

/** Expected possession window around the nearest planned handover date (node, else project) —
 *  the band widens as construction % falls. UNCONFIRMED bands; 06 has no per-unit forecast yet. */
export function possessionWindow(anchorDate: string | null, pct: number, basis: string): PossessionWindow | null {
  if (!anchorDate) return null;
  const confidence: PossessionWindow["confidence"] = pct >= 75 ? "HIGH" : pct >= 40 ? "MEDIUM" : "LOW";
  const months = confidence === "HIGH" ? 1 : confidence === "MEDIUM" ? 2 : 3;
  const shift = (iso: string, delta: number) => {
    const [y, m, day] = iso.split("-").map(Number) as [number, number, number];
    const lastDay = new Date(Date.UTC(y, m - 1 + delta + 1, 0)).getUTCDate(); // clamp 31 Mar ± 1 month to the target month's end
    return new Date(Date.UTC(y, m - 1 + delta, Math.min(day, lastDay))).toISOString().slice(0, 10);
  };
  return { from: shift(anchorDate, -months), to: shift(anchorDate, months), anchor: anchorDate, confidence, basis };
}
