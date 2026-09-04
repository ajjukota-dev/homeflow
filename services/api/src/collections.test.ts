import { describe, it, expect } from "vitest";
import {
  classifyOpenAmount,
  recoveryProbability,
  daysOverdue,
  type ClassifyInput,
} from "./collections";

// Pure unit tests for the true-risk engine (accounts/spec.md §2.3). T2 why-now
// tests live in why-now.test.ts.

const due: ClassifyInput = {
  remaining: 1_200_000,
  status: "due",
  due_date: "2026-09-10",
  as_of: "2026-09-03",
  loan_dependent: false,
  has_active_ptp: false,
  recovery_probability: 1,
  true_risk_threshold: 0.4,
};

describe("classifyOpenAmount", () => {
  it("returns null for settled, waived, scheduled, or zero remaining", () => {
    expect(classifyOpenAmount({ ...due, status: "settled" })).toBeNull();
    expect(classifyOpenAmount({ ...due, status: "waived" })).toBeNull();
    expect(classifyOpenAmount({ ...due, status: "scheduled" })).toBeNull();
    expect(classifyOpenAmount({ ...due, remaining: 0 })).toBeNull();
  });

  it("puts a future due date in DUE", () => {
    expect(classifyOpenAmount(due)).toBe("DUE");
  });

  it("lets disputed win over overdue, loan, and PTP", () => {
    expect(
      classifyOpenAmount({
        ...due,
        status: "disputed",
        due_date: "2026-07-01",
        loan_dependent: true,
        has_active_ptp: true,
        recovery_probability: 0.1,
      })
    ).toBe("DISPUTED");
  });

  it("classifies loan-dependent before PTP and overdue", () => {
    expect(
      classifyOpenAmount({
        ...due,
        due_date: "2026-07-01",
        loan_dependent: true,
        has_active_ptp: true,
        recovery_probability: 0.1,
      })
    ).toBe("LOAN_DEPENDENT");
  });

  it("classifies an active PTP before overdue", () => {
    expect(
      classifyOpenAmount({
        ...due,
        due_date: "2026-07-01",
        has_active_ptp: true,
        recovery_probability: 0.1,
      })
    ).toBe("PROMISE_TO_PAY");
  });

  it("keeps recoverable overdue in OVERDUE, not TRUE_RISK", () => {
    expect(
      classifyOpenAmount({
        ...due,
        status: "overdue",
        due_date: "2026-08-20",
        recovery_probability: 0.8,
      })
    ).toBe("OVERDUE");
  });

  it("flags overdue as TRUE_RISK when recovery probability is below the policy threshold", () => {
    expect(
      classifyOpenAmount({
        ...due,
        status: "overdue",
        due_date: "2026-06-01",
        recovery_probability: 0.25,
      })
    ).toBe("TRUE_RISK");
  });

  it("never puts an amount in two buckets — overdue + low probability is TRUE_RISK only", () => {
    const bucket = classifyOpenAmount({
      ...due,
      due_date: "2026-06-01",
      recovery_probability: 0.2,
    });
    expect(bucket).toBe("TRUE_RISK");
    expect(bucket).not.toBe("OVERDUE");
  });

  it("treats a null due_date (no trigger fired yet) as not past due, landing in DUE — never lost", () => {
    // A demand can leave "scheduled" without gaining a due_date (e.g. an early receipt);
    // it must still surface as owed money, not silently disappear from every bucket.
    expect(classifyOpenAmount({ ...due, status: "part_paid", due_date: null })).toBe("DUE");
  });
});

describe("recoveryProbability", () => {
  it("is 1 when not overdue", () => {
    expect(recoveryProbability(0)).toBe(1);
  });
  it("decays with ageing (explainable bands, not a hidden score)", () => {
    expect(recoveryProbability(10)).toBe(0.8);
    expect(recoveryProbability(30)).toBe(0.5);
    expect(recoveryProbability(70)).toBe(0.25);
  });
});

describe("daysOverdue", () => {
  it("is zero before the due date", () => {
    expect(daysOverdue("2026-09-10", "2026-09-03")).toBe(0);
  });
  it("counts calendar days past due", () => {
    expect(daysOverdue("2026-08-01", "2026-09-03")).toBe(33);
  });
  it("is zero for a null due_date rather than throwing", () => {
    expect(daysOverdue(null, "2026-09-03")).toBe(0);
  });
});
