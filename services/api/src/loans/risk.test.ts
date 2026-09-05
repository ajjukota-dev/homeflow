import { describe, it, expect } from "vitest";
import { computeLoanRisk } from "./risk";

// Rule 5 (21-loans.md): each driver fires independently and is explainable — same "pure engine,
// no hidden model" style as collections.test.ts's classifyOpenAmount tests.

const CLEAN: Parameters<typeof computeLoanRisk>[0] = {
  stage: "SANCTIONED",
  stage_age_days: 3,
  missing_docs_count: 0,
  validity_days_left: 60,
  days_since_last_event: 1,
  timing_gap_days: 10,
};

describe("computeLoanRisk", () => {
  it("scores 0 with no drivers when everything is healthy", () => {
    const r = computeLoanRisk(CLEAN);
    expect(r.score).toBe(0);
    expect(r.drivers).toEqual([]);
    expect(r.suggested_actions).toEqual([]);
  });

  it("STAGE_STALLED fires only in APPLICATION/SANCTION_PENDING past 15 days, not once sanctioned", () => {
    const stalled = computeLoanRisk({ ...CLEAN, stage: "APPLICATION", stage_age_days: 16 });
    expect(stalled.drivers.map((d) => d.code)).toContain("STAGE_STALLED");
    expect(stalled.suggested_actions).toContain("Chase lender");

    const sanctionedButOld = computeLoanRisk({ ...CLEAN, stage: "SANCTIONED", stage_age_days: 100 });
    expect(sanctionedButOld.drivers.map((d) => d.code)).not.toContain("STAGE_STALLED");
  });

  it("MISSING_DOCS scales with count, capped at 30 points", () => {
    const one = computeLoanRisk({ ...CLEAN, missing_docs_count: 1 });
    const many = computeLoanRisk({ ...CLEAN, missing_docs_count: 10 });
    expect(one.drivers[0]!.points).toBe(10);
    expect(many.drivers[0]!.points).toBe(30);
    expect(many.suggested_actions).toContain("Collect missing documents");
  });

  it("VALIDITY_EXPIRING vs SANCTION_EXPIRED are distinct drivers with different weight", () => {
    const expiring = computeLoanRisk({ ...CLEAN, validity_days_left: 5 });
    const expired = computeLoanRisk({ ...CLEAN, validity_days_left: -2 });
    expect(expiring.drivers[0]!.code).toBe("VALIDITY_EXPIRING");
    expect(expired.drivers[0]!.code).toBe("SANCTION_EXPIRED");
    expect(expired.drivers[0]!.points).toBeGreaterThan(expiring.drivers[0]!.points);
  });

  it("LENDER_UNRESPONSIVE fires past the threshold", () => {
    const r = computeLoanRisk({ ...CLEAN, days_since_last_event: 11 });
    expect(r.drivers.map((d) => d.code)).toContain("LENDER_UNRESPONSIVE");
  });

  it("TIMING_GAP fires only when the gap is negative (demand due before expected disbursement)", () => {
    const negative = computeLoanRisk({ ...CLEAN, timing_gap_days: -3 });
    const positive = computeLoanRisk({ ...CLEAN, timing_gap_days: 3 });
    expect(negative.drivers.map((d) => d.code)).toContain("TIMING_GAP");
    expect(positive.drivers.map((d) => d.code)).not.toContain("TIMING_GAP");
  });

  it("score sums every active driver and de-dupes suggested actions", () => {
    const r = computeLoanRisk({
      stage: "APPLICATION",
      stage_age_days: 20,
      missing_docs_count: 2,
      validity_days_left: 3,
      days_since_last_event: 12,
      timing_gap_days: -1,
    });
    expect(r.drivers.length).toBe(5);
    expect(r.score).toBe(25 + 20 + 20 + 15 + 20);
    expect(r.suggested_actions.filter((a) => a === "Chase lender").length).toBe(1); // both STAGE_STALLED and LENDER_UNRESPONSIVE suggest it
  });
});
