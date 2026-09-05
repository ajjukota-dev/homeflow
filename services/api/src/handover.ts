// Handover gates — 16-handover-gates.md p17 §9 (eight dimensions, verbatim from the client
// PDF; supersedes this file's own earlier six/nine-gate guess). Eligibility requires every hard
// gate PASSED or OVERRIDDEN. classification is config-driven (handover/store.ts's
// DEFAULT_GATE_CONFIG, overridable per project via handover_gate_config) rather than hardcoded,
// so `config` here is the read side of that table — this function stays pure and framework-free.

export type GateType =
  | "financial"
  | "legal"
  | "registration"
  | "physical"
  | "quality"
  | "commitments"
  | "customer"
  | "fm"
  | "snags";

export type GateClass = "hard" | "soft";
export type GateRunState = "open" | "passed";

// p17 §9 table, transcribed exactly: Commitments is HARD (this corrects an earlier guess in
// this file that called it soft, citing gates.md B.2's hard-gate list — gates.md is the legacy
// AI-derived draft, docs/specs/ is the authoritative build contract per CLAUDE.md, and 16's own
// Purpose line lists Commitments as hard). Physical has no override at all (p17 "no override");
// Financial's "Management only" override is enforced by handover/core.ts's route-level role
// check, not here. Applies to the 8 gates handover_gate_config's CHECK constraint enumerates —
// "snags" stays outside that table (see the gate below) since Purpose's own text splits Quality
// into "hard for critical, soft for minor": one config row (QUALITY) can't carry two
// classifications, so QUALITY here stays the hard critical+QA+minor-snag check exactly as
// before, and MAJOR-snag policy breaches keep surfacing on their own always-soft "snags" gate.
export const DEFAULT_GATE_CLASS: Record<Exclude<GateType, "snags">, GateClass> = {
  financial: "hard",
  legal: "hard",
  registration: "hard",
  physical: "hard",
  quality: "hard",
  commitments: "hard",
  customer: "soft",
  fm: "soft",
};

export interface HandoverInput {
  readiness_value: number;
  readiness_threshold: number;
  utilities_ready: boolean;
  critical_snags: number;
  minor_snags: number;
  minor_snag_max: number;
  qa_approved: boolean;
  financial_cleared: boolean;
  legal_executed: boolean;
  registered: boolean;
  // 13-promise-ledger.md rule 8: any commitment on the booking still open by the spec's own
  // definition (DRAFT/APPROVED/ACTIVE/AT_RISK/BREACHED) blocks; only FULFILLED/WAIVED pass.
  open_commitments: { code: string; description: string }[];
  // 15-qa-evidence-snags.md rule 7: open MAJOR snags above the project's policy count are a SOFT
  // blocker on their own "snags" gate (CRITICAL stays hard via critical_snags above, per
  // Purpose's "hard for critical, soft for minor"). Rule 4: PENDING/IN_PROGRESS external
  // dependencies on the unit's ancestor nodes surface on the FM/Community gate.
  major_snags?: number;
  major_snag_max?: number;
  dependency_blockers?: string[];
}

export interface HandoverGateView {
  type: GateType;
  classification: GateClass;
  state: GateRunState;
  blockers: string[];
}

function gate(
  type: GateType,
  classification: GateClass,
  passed: boolean,
  blockers: string[]
): HandoverGateView {
  return { type, classification, state: passed ? "passed" : "open", blockers: passed ? [] : blockers };
}

/** classOverrides lets a caller supply per-project handover_gate_config classification instead
 *  of DEFAULT_GATE_CLASS — omitted by every existing caller (qa.ts, tests), which get the
 *  spec-default table unchanged. */
export function evaluateHandover(input: HandoverInput, classOverrides?: Partial<Record<Exclude<GateType, "snags">, GateClass>>) {
  const cls = (t: Exclude<GateType, "snags">): GateClass => classOverrides?.[t] ?? DEFAULT_GATE_CLASS[t];
  const physicalBlockers = [
    ...(input.readiness_value >= input.readiness_threshold
      ? []
      : [`Readiness ${input.readiness_value} is below the threshold ${input.readiness_threshold}`]),
    ...(input.utilities_ready ? [] : ["Utilities are not available"]),
    ...(input.critical_snags === 0 ? [] : ["Safety-critical snags are open"]),
  ];
  const qualityBlockers = [
    ...(input.qa_approved ? [] : ["QA has not approved all components"]),
    ...(input.critical_snags === 0 ? [] : ["A critical snag is still open"]),
    ...(input.minor_snags <= input.minor_snag_max ? [] : ["Minor snags exceed policy"]),
  ];

  const gates: HandoverGateView[] = [
    gate("financial", cls("financial"), input.financial_cleared, ["Required consideration not received to the registration threshold"]),
    gate("legal", cls("legal"), input.legal_executed, ["Executed agreement is missing"]),
    gate("registration", cls("registration"), input.registered, ["Registration is not complete"]),
    gate("physical", cls("physical"), physicalBlockers.length === 0, physicalBlockers),
    gate("quality", cls("quality"), qualityBlockers.length === 0, qualityBlockers),
    // 13-promise-ledger.md rule 8, now real (previously always-open — TODO.md task 6, closed).
    // Scoped to ALL open commitments on the booking, not just customer-facing/critical ones
    // gates.md's own illustrative B.1 text names — 13's rule 8 says "any commitment... → gate
    // open."
    gate("commitments", cls("commitments"), input.open_commitments.length === 0, input.open_commitments.map((c) => `${c.code}: ${c.description}`)),
    gate("customer", cls("customer"), true, []),
    gate("fm", cls("fm"), (input.dependency_blockers ?? []).length === 0, input.dependency_blockers ?? []),
    gate("snags", "soft", (input.major_snags ?? 0) <= (input.major_snag_max ?? 0), [`${input.major_snags ?? 0} major snag(s) open, policy allows ${input.major_snag_max ?? 0}`]),
  ];

  const hardOpen = gates.filter((g) => g.classification === "hard" && g.state !== "passed");
  const blockers = hardOpen.flatMap((g) => g.blockers.map((reason) => ({ gate: g.type, reason })));
  const eligible = hardOpen.length === 0;
  const lifecycle = eligible ? "eligible" : hardOpen.length <= 2 ? "at_risk" : "not_eligible";
  return { eligible, lifecycle, gates, blockers };
}

export function applyOverride(input: {
  gate_type: GateType | string;
  safety_critical: boolean;
  authority_id: string;
  reason: string;
}): { allowed: boolean; code?: string } {
  if (input.safety_critical) return { allowed: false, code: "SAFETY_GATE_NOT_OVERRIDABLE" };
  if (!input.authority_id?.trim() || !input.reason?.trim()) {
    return { allowed: false, code: "OVERRIDE_REQUIRES_AUTHORITY" };
  }
  return { allowed: true };
}
