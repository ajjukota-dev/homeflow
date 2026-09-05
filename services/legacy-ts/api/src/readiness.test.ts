import { describe, it, expect } from "vitest";
import { readinessScore } from "./readiness";

const COMPONENTS = [
  { code: "structure", qa_verified: true },
  { code: "mep_first_fix", qa_verified: true },
  { code: "flooring", qa_verified: false },
  { code: "finishing", qa_verified: false },
];

describe("readinessScore", () => {
  it("is derived from independently verified components, never a typed percentage", () => {
    const result = readinessScore(COMPONENTS, 0);
    expect(result.value).toBe(50);
    expect(result.drivers[0]).toMatch(/2 of 4 components independently verified/);
  });

  it("does not treat site-declared progress as QA evidence", () => {
    const siteCompleteButUnverified = [
      { code: "structure", qa_verified: false },
      { code: "mep_first_fix", qa_verified: false },
    ];
    expect(readinessScore(siteCompleteButUnverified, 0).value).toBe(0);
  });

  it("penalises open critical snags", () => {
    const allVerified = COMPONENTS.map((c) => ({ ...c, qa_verified: true }));
    const result = readinessScore(allVerified, 1);
    expect(result.value).toBe(75);
    expect(result.drivers.some((d) => /critical snag/i.test(d))).toBe(true);
  });
});
