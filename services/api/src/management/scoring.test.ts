import { describe, it, expect } from "vitest";
import { pickFive, impactScore, TOWER_CATEGORIES, type TowerCandidate, type RankingWeights } from "./scoring";

const WEIGHTS: RankingWeights = { inr: 1, customers: 100000, days: 50000 };

const CANDIDATES: TowerCandidate[] = [
  {
    category: "cash",
    headline: "Karthik Iyer, Villa V110 — a long-overdue instalment has gone quiet",
    what_happened: "Flooring milestone unpaid for 70 days with no response.",
    impact: { inr: 2_400_000, customers: 1, days: 70 },
    owner: "Priya Nair",
    recommended_decision: "Escalate to the RM and offer a structured recovery plan",
    evidence_links: ["booking:b_v110"],
    source_refs: ["demand:d_v110"],
    booking_id: "b_v110",
    unit_id: "u_v110",
    dependencies: ["collections"],
  },
  {
    category: "cash",
    headline: "Smaller overdue elsewhere",
    what_happened: "A smaller overdue.",
    impact: { inr: 50_000, customers: 1, days: 5 },
    owner: "Priya Nair",
    recommended_decision: "Call",
    evidence_links: [],
    source_refs: ["demand:d_other"],
    dependencies: [],
  },
  {
    category: "reputation",
    headline: "Meera Krishnan, Villa V111 — exposed wiring is still open",
    what_happened: "Critical snag open on a booked villa.",
    impact: { inr: 0, customers: 1, days: 1 },
    owner: "QA lead",
    recommended_decision: "Rectify before any keys conversation",
    evidence_links: ["snag:s_v111_1"],
    source_refs: ["snag:s_v111_1"],
    booking_id: "b_v111",
    unit_id: "u_v111",
    dependencies: ["qa"],
  },
];

describe("impactScore", () => {
  it("weighs ₹, customers, and days per the configured weights (rule 1)", () => {
    const bigCash = impactScore({ inr: 1_000_000, customers: 1, days: 1 }, WEIGHTS);
    const manyCustomers = impactScore({ inr: 0, customers: 20, days: 1 }, WEIGHTS);
    expect(manyCustomers).toBeGreaterThan(bigCash); // 20 customers * 100000 > ₹1M / 1
  });
});

describe("pickFive", () => {
  it("always returns exactly one intervention per category", () => {
    const five = pickFive(CANDIDATES, WEIGHTS);
    expect(five.map((i) => i.category).sort()).toEqual([...TOWER_CATEGORIES].sort());
    expect(five.map((i) => i.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("picks the highest composite-score candidate in a category", () => {
    const cash = pickFive(CANDIDATES, WEIGHTS).find((i) => i.category === "cash")!;
    expect(cash.material).toBe(true);
    expect(cash.headline).toMatch(/Karthik Iyer/);
    expect(cash.decision_pack.recommended_decision).toMatch(/recovery plan/);
    expect(cash.decision_pack.impact.days).toBe(70);
  });

  it("fills an empty category with a calm all-clear card, not a blank slot", () => {
    const margin = pickFive(CANDIDATES, WEIGHTS).find((i) => i.category === "margin")!;
    expect(margin.material).toBe(false);
    expect(margin.headline).toMatch(/No material margin exception/i);
    expect(margin.decision_pack.recommended_decision).toBe("No action needed today");
  });

  it("rule 2: a candidate whose source_ref was recently dismissed is skipped", () => {
    const withoutSkip = pickFive(CANDIDATES, WEIGHTS).find((i) => i.category === "cash")!;
    expect(withoutSkip.headline).toMatch(/Karthik Iyer/);
    const withSkip = pickFive(CANDIDATES, WEIGHTS, new Set(["demand:d_v110"])).find((i) => i.category === "cash")!;
    expect(withSkip.headline).toMatch(/Smaller overdue/);
  });
});
