import { describe, it, expect } from "vitest";
import { pickFive, TOWER_CATEGORIES, type TowerCandidate } from "./tower";

const CANDIDATES: TowerCandidate[] = [
  {
    category: "cash",
    headline: "Karthik Iyer, Villa V110 — a long-overdue instalment has gone quiet",
    what_happened: "Flooring milestone unpaid for 70 days with no response.",
    impact_rupee: 2_400_000,
    impact_customer: "Karthik Iyer",
    owner: "Priya Nair",
    recommended_decision: "Escalate to the RM and offer a structured recovery plan",
    evidence_links: ["booking:b_v110"],
    booking_id: "b_v110",
    unit_id: "u_v110",
    dependencies: ["collections"],
  },
  {
    category: "cash",
    headline: "Smaller overdue elsewhere",
    what_happened: "A smaller overdue.",
    impact_rupee: 50_000,
    impact_customer: "Someone",
    owner: "Priya Nair",
    recommended_decision: "Call",
    evidence_links: [],
    dependencies: [],
  },
  {
    category: "reputation",
    headline: "Meera Krishnan, Villa V111 — exposed wiring is still open",
    what_happened: "Critical snag open on a booked villa.",
    impact_rupee: 0,
    impact_customer: "Meera Krishnan",
    owner: "QA lead",
    recommended_decision: "Rectify before any keys conversation",
    evidence_links: ["snag:s_v111_1"],
    booking_id: "b_v111",
    unit_id: "u_v111",
    dependencies: ["qa"],
  },
];

describe("pickFive", () => {
  it("always returns exactly one intervention per category, ranked 1–5", () => {
    const five = pickFive(CANDIDATES);
    expect(five.map((i) => i.category)).toEqual([...TOWER_CATEGORIES]);
    expect(five.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("picks the highest rupee-impact candidate in a category", () => {
    const cash = pickFive(CANDIDATES).find((i) => i.category === "cash")!;
    expect(cash.material).toBe(true);
    expect(cash.headline).toMatch(/Karthik Iyer/);
    expect(cash.decision_pack.recommended_decision).toMatch(/recovery plan/);
    expect(cash.decision_pack.what_happened).toMatch(/70 days/);
  });

  it("fills an empty category with a calm all-clear card, not a blank slot", () => {
    const margin = pickFive(CANDIDATES).find((i) => i.category === "margin")!;
    expect(margin.material).toBe(false);
    expect(margin.headline).toMatch(/No material margin exception/i);
    expect(margin.decision_pack.recommended_decision).toBe("No action needed today");
  });
});
