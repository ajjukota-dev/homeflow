import { describe, it, expect } from "vitest";
import { financialClearance } from "./clearance";

describe("financialClearance (H7)", () => {
  it("clears when paid share meets the policy threshold and nothing is disputed", () => {
    const result = financialClearance({
      paid: 9_000_000,
      consideration: 10_000_000,
      threshold_pct: 0.7,
      disputed: 0,
    });
    expect(result.cleared).toBe(true);
    expect(result.paid_pct).toBeCloseTo(0.9);
    expect(result.reason).toBeNull();
  });

  it("blocks when paid share is below the registration threshold", () => {
    const result = financialClearance({
      paid: 1_200_000,
      consideration: 12_000_000,
      threshold_pct: 0.7,
      disputed: 0,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("below_registration_threshold");
  });

  it("blocks when unapproved disputed dues remain, even if enough is paid", () => {
    const result = financialClearance({
      paid: 9_000_000,
      consideration: 10_000_000,
      threshold_pct: 0.7,
      disputed: 400_000,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("unapproved_disputed_dues");
  });
});
