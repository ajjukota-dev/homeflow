import { describe, it, expect } from "vitest";
import { whyNow } from "./collections";

// Pure unit tests for T2 why-now (customer-transparency.md §5.2) — split out of
// collections.test.ts to stay under the 200-line file limit.

describe("whyNow (T2 — derived from real component progress)", () => {
  it("names the real state when the trigger has reached verified", () => {
    expect(
      whyNow({
        milestone_label: "Possession",
        construction_trigger_event: "finishing:verified",
        status: "due",
        component_state: "verified",
      })
    ).toBe("Finishing verified — payment due.");
  });

  it("names the real state when only complete — never upgrades to verified", () => {
    expect(
      whyNow({
        milestone_label: "Structure complete",
        construction_trigger_event: "structure:complete",
        status: "due",
        component_state: "complete",
      })
    ).toBe("Structure complete — payment due.");
  });

  it("explains a booking-time payment with no construction trigger", () => {
    expect(
      whyNow({
        milestone_label: "Booking amount",
        construction_trigger_event: null,
        status: "due",
        component_state: null,
      })
    ).toBe("Booking payment — due.");
  });

  it("explains a scheduled demand without claiming the stage is done", () => {
    const text = whyNow({
      milestone_label: "Flooring laid",
      construction_trigger_event: "flooring:complete",
      status: "scheduled",
      component_state: "not_started",
    });
    expect(text).toBe("Upcoming — after flooring is verified.");
  });

  it("never claims a stage is done when the trigger component hasn't reached it", () => {
    const text = whyNow({
      milestone_label: "Flooring laid",
      construction_trigger_event: "flooring:complete",
      status: "overdue",
      component_state: "not_started",
    });
    expect(text).toBe("Payment due.");
  });

  it("never leaks internal codes or state tokens in any branch", () => {
    const sentences = [
      whyNow({
        milestone_label: "Structure complete",
        construction_trigger_event: "structure:complete",
        status: "due",
        component_state: "verified",
      }),
      whyNow({
        milestone_label: "Booking amount",
        construction_trigger_event: null,
        status: "due",
        component_state: null,
      }),
      whyNow({
        milestone_label: "Flooring laid",
        construction_trigger_event: "flooring:complete",
        status: "scheduled",
        component_state: "not_started",
      }),
      whyNow({
        milestone_label: "Flooring laid",
        construction_trigger_event: "flooring:complete",
        status: "overdue",
        component_state: "not_started",
      }),
    ];
    for (const s of sentences) {
      expect(s).not.toMatch(/_/);
      expect(s).not.toMatch(/TRUE_RISK|EXCEPTION_ONLY|HARD_CLOSED/);
    }
  });
});
