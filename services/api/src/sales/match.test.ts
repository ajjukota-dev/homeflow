import { describe, it, expect } from "vitest";
import { computeMatch, constructionPct, possessionWindow, MATCH_DISCLAIMER, type MatchGate } from "./match";
import { DEFAULT_SALES_POLICY } from "./policy";

// 24-sales-inventory-discovery.md rule 4 (pure) + the inventory derivations behind rule 1.

const gate = (category_code: string, state: MatchGate["state"], extra: Partial<MatchGate> = {}): MatchGate => ({
  category_code, customer_label: category_code === "kitchen_layout" ? "Kitchen layout" : category_code === "structural" ? "Structural changes" : "Electrical additions",
  state, reason_text: "No closing event yet", expected_close_at: null, freshness_status: "FRESH", ...extra,
});

describe("rule 4 — requirement compatibility", () => {
  it("weights MUST 3 / PREFERRED 1 / NOT 0 against state values, and always appends the disclaimer", () => {
    const m = computeMatch(
      [
        { category_code: "kitchen_layout", importance: "MUST_HAVE" },
        { category_code: "electrical", importance: "PREFERRED" },
        { category_code: "structural", importance: "NOT_IMPORTANT" },
      ],
      [gate("kitchen_layout", "CLOSING", { expected_close_at: "2026-10-14", reason_text: "flooring not yet started" }), gate("electrical", "OPEN"), gate("structural", "HARD_CLOSED")],
      DEFAULT_SALES_POLICY
    );
    expect(m.score).toBe(81); // (3×0.75 + 1×1 + 0) / 4 = 0.8125
    expect(m.disclaimer).toBe(MATCH_DISCLAIMER);
    expect(m.explanation[0]).toMatchObject({ category: "kitchen_layout", verdict: "CLOSING", text: "Kitchen layout changes are open until ~2026-10-14 (flooring not yet started)." });
    expect(m.explanation[2]).toMatchObject({ verdict: "NOT_POSSIBLE" });
    expect(m.stale_inputs).toBe(false);
  });

  it("a MUST_HAVE in HARD_CLOSED caps the score at 40 with verdict NOT_POSSIBLE", () => {
    const m = computeMatch(
      [{ category_code: "structural", importance: "MUST_HAVE" }, { category_code: "kitchen_layout", importance: "PREFERRED" }, { category_code: "electrical", importance: "PREFERRED" }],
      [gate("structural", "HARD_CLOSED", { reason_text: "structure reached verified" }), gate("kitchen_layout", "OPEN"), gate("electrical", "OPEN")],
      DEFAULT_SALES_POLICY
    );
    expect(m.score).toBe(40); // uncapped would be (0 + 1 + 1) / 5 = 40 anyway → assert the cap with a higher raw score below
    const high = computeMatch(
      [{ category_code: "structural", importance: "MUST_HAVE" }, ...Array.from({ length: 10 }, (_, i) => ({ category_code: `c${i}`, importance: "PREFERRED" as const }))],
      [gate("structural", "HARD_CLOSED")],
      DEFAULT_SALES_POLICY
    );
    expect(high.score).toBe(40); // raw 10/13 = 77 → capped
    expect(high.explanation[0]).toMatchObject({ verdict: "NOT_POSSIBLE", text: "Structural changes changes are closed — no closing event yet." });
  });

  it("no needs → 100; stale gate inputs are flagged", () => {
    expect(computeMatch([], [], DEFAULT_SALES_POLICY).score).toBe(100);
    expect(computeMatch([{ category_code: "electrical", importance: "MUST_HAVE" }], [gate("electrical", "CLOSING", { freshness_status: "VERIFICATION_REQUIRED" })], DEFAULT_SALES_POLICY).stale_inputs).toBe(true);
  });
});

describe("inventory derivations", () => {
  it("construction % uses 07's pct when recorded, else the state share, weighted", () => {
    expect(constructionPct([])).toBe(0);
    expect(constructionPct([{ state: "complete", pct: null, weight: 1 }, { state: "not_started", pct: null, weight: 1 }])).toBe(50);
    expect(constructionPct([{ state: "in_progress", pct: 80, weight: 3 }, { state: "in_progress", pct: null, weight: 1 }])).toBe(73); // (2.4 + 0.5) / 4
  });
  it("possession window widens as construction % falls", () => {
    expect(possessionWindow(null, 50, "x")).toBeNull();
    expect(possessionWindow("2027-03-31", 90, "project planned handover")).toMatchObject({ from: "2027-02-28", to: "2027-04-30", confidence: "HIGH" });
    expect(possessionWindow("2027-03-31", 10, "project planned handover")).toMatchObject({ from: "2026-12-31", to: "2027-06-30", confidence: "LOW" });
  });
});
