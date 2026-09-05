import { describe, expect, it } from "vitest";
import { costInr } from "./pricing";

// Money-safe: TDD per 00-conventions.md / CLAUDE.md. gpt-4o-mini pricing is
// $0.15 / 1M input tokens, $0.60 / 1M output tokens; USD→INR is an [ours]
// approximation (see pricing.ts) pending a live FX rate.
describe("llm pricing — costInr", () => {
  it("is zero for zero tokens", () => {
    expect(costInr(0, 0)).toBe(0);
  });

  it("prices input and output tokens at their separate published rates", () => {
    // 1,000,000 input tokens @ $0.15 = $0.15; 1,000,000 output @ $0.60 = $0.60.
    // Total $0.75 * 83 INR/USD = 62.25.
    expect(costInr(1_000_000, 1_000_000)).toBeCloseTo(62.25, 4);
  });

  it("scales linearly with token count (within 4dp rounding)", () => {
    expect(costInr(200_000, 0)).toBeCloseTo(costInr(100_000, 0) * 2, 3);
  });

  it("never returns a negative cost", () => {
    expect(costInr(1, 1)).toBeGreaterThanOrEqual(0);
  });
});
