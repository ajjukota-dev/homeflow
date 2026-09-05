import { describe, it, expect } from "vitest";
import { rupeesToPaise, paiseToRupees, sumRupees, applyPercent, paidFraction, formatIndianGrouping } from "./money";

// Rule 11: money math in integer paise, never JS float on rupees.

describe("rupeesToPaise / paiseToRupees", () => {
  it("round-trips exactly", () => {
    expect(rupeesToPaise(120.5)).toBe(12050);
    expect(paiseToRupees(12050)).toBe(120.5);
  });
  it("rounds to the nearest paise", () => {
    expect(rupeesToPaise(10.005)).toBe(1001); // 10.005 * 100 = 1000.4999... in float64, rounds to 1000 or 1001 deterministically
  });
  it("throws on a non-finite input rather than producing NaN", () => {
    expect(() => rupeesToPaise(NaN)).toThrow();
    expect(() => rupeesToPaise("not a number")).toThrow();
  });
});

describe("sumRupees — the exact case JS float addition gets wrong", () => {
  it("0.1 + 0.2 style rupee amounts sum exactly, not 0.30000000000000004", () => {
    expect(sumRupees([0.1, 0.2])).toBe(0.3);
  });
  it("sums a real demand-schedule shape without drift", () => {
    expect(sumRupees([1_200_000, 3_600_000.5, 2_400_000.25, 2_400_000.25])).toBe(9_600_001);
  });
});

describe("applyPercent — TDS-style percentage math", () => {
  it("1% of a ₹50,00,000 agreement value is ₹50,000 (§194IA)", () => {
    expect(applyPercent(5_000_000, 1)).toBe(50_000);
  });
  it("rounds to the nearest paise, not truncates", () => {
    expect(applyPercent(100, 33.33)).toBe(33.33);
  });
});

describe("paidFraction — clearance threshold math", () => {
  it("computes an exact fraction from paise, not float-noisy division", () => {
    expect(paidFraction(7_000_000, 10_000_000)).toBe(0.7);
  });
  it("is 0 when total is not positive, never divides by zero", () => {
    expect(paidFraction(0, 0)).toBe(0);
    expect(paidFraction(100, -5)).toBe(0);
  });
});

describe("formatIndianGrouping", () => {
  it("groups in the Indian style (lakh/crore), not Western thousands", () => {
    expect(formatIndianGrouping(12_000_000)).toBe("1,20,00,000");
    expect(formatIndianGrouping(150_000)).toBe("1,50,000");
  });
});
