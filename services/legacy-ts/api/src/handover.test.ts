import { describe, it, expect } from "vitest";
import { applyOverride, evaluateHandover } from "./handover";

const READY = {
  readiness_value: 100,
  readiness_threshold: 80,
  utilities_ready: true,
  critical_snags: 0,
  minor_snags: 1,
  minor_snag_max: 2,
  qa_approved: true,
  financial_cleared: true,
  legal_executed: true,
  registered: true,
};

describe("evaluateHandover (H9)", () => {
  it("is eligible only when every hard gate has passed", () => {
    const result = evaluateHandover(READY);
    expect(result.eligible).toBe(true);
    expect(result.lifecycle).toBe("eligible");
    expect(result.gates.filter((g) => g.classification === "hard").every((g) => g.state === "passed")).toBe(true);
  });

  it("blocks eligibility when any critical snag is open", () => {
    const result = evaluateHandover({ ...READY, critical_snags: 1, qa_approved: true });
    expect(result.eligible).toBe(false);
    expect(result.blockers.some((b) => b.gate === "quality")).toBe(true);
    expect(result.blockers.some((b) => /critical snag/i.test(b.reason))).toBe(true);
  });

  it("lists finance and registration blockers without pretending the villa is ready", () => {
    const result = evaluateHandover({
      ...READY,
      financial_cleared: false,
      registered: false,
      readiness_value: 50,
      qa_approved: false,
      utilities_ready: false,
    });
    expect(result.eligible).toBe(false);
    const types = result.blockers.map((b) => b.gate);
    expect(types).toContain("financial");
    expect(types).toContain("registration");
    expect(types).toContain("physical");
  });
});

describe("applyOverride", () => {
  it("rejects override of a safety-critical physical gate even with named authority", () => {
    const result = applyOverride({
      gate_type: "physical",
      safety_critical: true,
      authority_id: "ceo",
      reason: "customer is waiting",
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("SAFETY_GATE_NOT_OVERRIDABLE");
  });

  it("rejects a hard-gate override that has no named authority and reason", () => {
    const result = applyOverride({
      gate_type: "financial",
      safety_critical: false,
      authority_id: "",
      reason: "",
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("OVERRIDE_REQUIRES_AUTHORITY");
  });
});
