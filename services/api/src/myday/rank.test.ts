import { describe, it, expect } from "vitest";
import { scoreAction, whyNow, DEFAULT_WEIGHTS, type RankInput } from "./rank";

const NOW = "2026-01-15T12:00:00.000Z";
const base: RankInput = { id: "a1", due_at: null, clock_status: null, customer_count: 0, customer_visible: false, revenue_inr: 0, project_median_demand_inr: 100000, dependency_count: 0, escalation_tier: "L0" };

describe("scoreAction (rule 2) — table-driven term behavior", () => {
  it("scores an overdue action higher than a comfortably-due one, all else equal", () => {
    const overdue = scoreAction({ ...base, due_at: "2026-01-14T12:00:00.000Z" }, DEFAULT_WEIGHTS, NOW);
    const comfy = scoreAction({ ...base, due_at: "2026-01-25T12:00:00.000Z" }, DEFAULT_WEIGHTS, NOW);
    expect(overdue.score).toBeGreaterThan(comfy.score);
    expect(overdue.terms.deadline).toBe(1.0);
  });

  it("an OVERDUE clock status forces escalation_risk to its maximum regardless of tier", () => {
    const r = scoreAction({ ...base, clock_status: "OVERDUE", escalation_tier: "L0" }, DEFAULT_WEIGHTS, NOW);
    expect(r.terms.escalation_risk).toBe(1.0);
  });

  it("a customer-visible action with more affected customers scores a higher customer_impact term", () => {
    const low = scoreAction({ ...base, customer_count: 0, customer_visible: false }, DEFAULT_WEIGHTS, NOW);
    const high = scoreAction({ ...base, customer_count: 3, customer_visible: true }, DEFAULT_WEIGHTS, NOW);
    expect(high.terms.customer_impact).toBeGreaterThan(low.terms.customer_impact);
  });

  it("revenue well above the project median scores a higher revenue_impact term than revenue near zero", () => {
    const low = scoreAction({ ...base, revenue_inr: 1000 }, DEFAULT_WEIGHTS, NOW);
    const high = scoreAction({ ...base, revenue_inr: 1000000 }, DEFAULT_WEIGHTS, NOW);
    expect(high.terms.revenue_impact).toBeGreaterThan(low.terms.revenue_impact);
  });

  it("more dependent actions scores a higher dependency_impact term", () => {
    const none = scoreAction({ ...base, dependency_count: 0 }, DEFAULT_WEIGHTS, NOW);
    const many = scoreAction({ ...base, dependency_count: 5 }, DEFAULT_WEIGHTS, NOW);
    expect(many.terms.dependency_impact).toBeGreaterThan(none.terms.dependency_impact);
  });
});

describe("whyNow (rule 3) — top two contributing terms as fact sentences", () => {
  it("names the overdue fact and the escalation fact for a breached, escalated action", () => {
    const input: RankInput = { ...base, due_at: "2026-01-10T12:00:00.000Z", clock_status: "OVERDUE", escalation_tier: "L2" };
    const ranked = scoreAction(input, DEFAULT_WEIGHTS, NOW);
    const line = whyNow(input, ranked, NOW);
    expect(line).toMatch(/Overdue/);
    expect(line).toMatch(/SLA breached/);
    expect(line.split(" · ").length).toBeLessThanOrEqual(2);
  });

  it("never returns an empty string, even when no positive term fired", () => {
    const ranked = scoreAction(base, DEFAULT_WEIGHTS, NOW);
    const line = whyNow(base, ranked, NOW);
    expect(line.length).toBeGreaterThan(0);
  });
});
