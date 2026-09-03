import { describe, it, expect } from "vitest";
import { deriveGate, changeabilityScore, type ChangeGateRule } from "./gates";

// Pure unit tests for the changeability gate engine (foundation/gates.md A.3).
const rules: ChangeGateRule[] = [
  { category_code: "electrical", trigger_component_code: "mep_first_fix", min_state: "in_progress", resulting_state: "CLOSING" },
  { category_code: "electrical", trigger_component_code: "mep_first_fix", min_state: "complete", resulting_state: "EXCEPTION_ONLY" },
  { category_code: "structural", trigger_component_code: "structure", min_state: "complete", resulting_state: "HARD_CLOSED" },
];

describe("deriveGate", () => {
  it("is OPEN before any trigger is reached", () => {
    expect(deriveGate("electrical", { mep_first_fix: "not_started" }, rules).state).toBe("OPEN");
  });

  it("moves to CLOSING once the trigger reaches in_progress", () => {
    expect(deriveGate("electrical", { mep_first_fix: "in_progress" }, rules).state).toBe("CLOSING");
  });

  it("applies the most-restrictive satisfied rule (EXCEPTION_ONLY at complete)", () => {
    expect(deriveGate("electrical", { mep_first_fix: "complete" }, rules).state).toBe("EXCEPTION_ONLY");
  });

  it("HARD_CLOSED for structural once structure is cast", () => {
    expect(deriveGate("structural", { structure: "complete" }, rules).state).toBe("HARD_CLOSED");
  });

  it("returns an explainable reason", () => {
    expect(deriveGate("electrical", { mep_first_fix: "in_progress" }, rules).reason).toContain("mep_first_fix");
  });
});

describe("changeabilityScore", () => {
  it("all OPEN = 100", () => {
    expect(changeabilityScore(["OPEN", "OPEN", "OPEN"])).toBe(100);
  });
  it("HARD_CLOSED tanks the score", () => {
    expect(changeabilityScore(["HARD_CLOSED"])).toBe(5);
  });
  it("averages mixed states", () => {
    // OPEN(100) + EXCEPTION_ONLY(20) = 60
    expect(changeabilityScore(["OPEN", "EXCEPTION_ONLY"])).toBe(60);
  });
});
