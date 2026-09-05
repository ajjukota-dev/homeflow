import { describe, it, expect } from "vitest";
import { deriveFreshness } from "./freshness";

const AS_OF = "2026-09-20T00:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.parse(AS_OF) - n * 24 * 60 * 60 * 1000).toISOString();

describe("deriveFreshness (07 rule 6)", () => {
  it("is FRESH while inside the component's threshold", () => {
    expect(deriveFreshness({ state: "in_progress", updatedAt: daysAgo(5), staleAfterDays: 14, gateDependent: true, asOf: AS_OF })).toBe("FRESH");
  });

  it("goes STALE past the threshold, and VERIFICATION_REQUIRED when a gate depends on the reading", () => {
    expect(deriveFreshness({ state: "in_progress", updatedAt: daysAgo(15), staleAfterDays: 14, gateDependent: false, asOf: AS_OF })).toBe("STALE");
    expect(deriveFreshness({ state: "in_progress", updatedAt: daysAgo(15), staleAfterDays: 14, gateDependent: true, asOf: AS_OF })).toBe("VERIFICATION_REQUIRED");
  });

  it("never marks a settled state stale — COMPLETE/VERIFIED/NOT_STARTED are states, not readings", () => {
    expect(deriveFreshness({ state: "complete", updatedAt: daysAgo(400), staleAfterDays: 14, gateDependent: true, asOf: AS_OF })).toBe("FRESH");
    expect(deriveFreshness({ state: "not_started", updatedAt: daysAgo(400), staleAfterDays: 14, gateDependent: true, asOf: AS_OF })).toBe("FRESH");
  });
});
