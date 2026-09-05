// Handover hard/soft gates — gates.md Part B + handshake H9.
// Eligibility requires every hard gate. Safety-critical physical items are never overridable.

export type GateType =
  | "financial"
  | "legal"
  | "registration"
  | "physical"
  | "quality"
  | "commitments"
  | "customer"
  | "fm";

export type GateClass = "hard" | "soft";
export type GateRunState = "open" | "passed";

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
  commitments_clear?: boolean;
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

export function evaluateHandover(input: HandoverInput) {
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
    gate("financial", "hard", input.financial_cleared, ["Required consideration not received to the registration threshold"]),
    gate("legal", "hard", input.legal_executed, ["Executed agreement is missing"]),
    gate("registration", "hard", input.registered, ["Registration is not complete"]),
    gate("physical", "hard", physicalBlockers.length === 0, physicalBlockers),
    gate("quality", "hard", qualityBlockers.length === 0, qualityBlockers),
    gate("commitments", "hard", input.commitments_clear !== false, ["Critical customer commitments are still open"]),
    gate("customer", "soft", true, []),
    gate("fm", "soft", true, []),
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
