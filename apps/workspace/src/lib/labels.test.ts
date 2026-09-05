import { describe, expect, it } from "vitest";
import {
  bookingStatusLabel,
  dlpWindowStatusLabel,
  documentStatusLabel,
  eventDescription,
  eventFamily,
  gateRunStateLabel,
  gateTypeLabel,
  interventionCategoryLabel,
  kycStatusLabel,
  registrationStatusLabel,
  saleStatusLabel,
  snagSeverityLabel,
  warrantyCaseStatusLabel,
} from "./labels";

// Each of the 3 raw-enum bugs task 8 was filed for (TODO.md, Amarsh #8).
describe("the three reported bugs", () => {
  it("sale status: handed_over -> Handed over (not Handed_over)", () => {
    expect(saleStatusLabel("handed_over")).toBe("Handed over");
  });
  it("handover gate type: financial -> Financial clearance (not raw financial · open)", () => {
    expect(gateTypeLabel("financial")).toBe("Financial clearance");
    expect(gateRunStateLabel("open")).toBe("Open");
  });
  it("registration status: readiness_in_progress -> Readiness in progress", () => {
    expect(registrationStatusLabel("readiness_in_progress")).toBe("Readiness in progress");
  });
});

describe("every map is exhaustive and never returns empty/undefined", () => {
  const cases: [(v: string) => string, string[]][] = [
    [saleStatusLabel, ["available", "held", "booked", "registered", "handed_over"]],
    [bookingStatusLabel, ["submitted", "active", "returned"]],
    [kycStatusLabel, ["pending", "verified"]],
    [documentStatusLabel, ["none", "draft", "legal_approved", "executed", "archived"]],
    [registrationStatusLabel, ["not_ready", "readiness_in_progress", "ready", "slot_booked", "completed"]],
    [snagSeverityLabel, ["critical", "major", "minor"]],
    [
      gateTypeLabel,
      ["financial", "legal", "registration", "physical", "quality", "commitments", "customer", "fm"],
    ],
    [gateRunStateLabel, ["open", "passed"]],
    [dlpWindowStatusLabel, ["active"]],
    [warrantyCaseStatusLabel, ["open", "closed"]],
    [interventionCategoryLabel, ["customer", "cash", "handover", "reputation", "margin"]],
  ];

  for (const [fn, values] of cases) {
    for (const v of values) {
      it(`${fn.name}("${v}") is a non-empty human string`, () => {
        const label = fn(v);
        expect(label).toBeTruthy();
        expect(label).not.toBe(v);
        expect(label[0]).toBe(label[0].toUpperCase());
      });
    }
  }
});

describe("fallback for unknown values", () => {
  it("title-cases an unknown snake_case value instead of crashing", () => {
    expect(saleStatusLabel("some_new_status")).toBe("Some New Status");
  });
  it("title-cases an unknown SCREAMING_SNAKE value", () => {
    expect(gateTypeLabel("SOME_NEW_GATE")).toBe("Some New Gate");
  });
  it("never renders an empty string for an empty input", () => {
    expect(saleStatusLabel("")).toBe("");
  });
});

// ActivityFeed rendering (spec 02 Screens): every built event type reads as a plain sentence.
describe("eventDescription — plain-language activity feed (02 Screens)", () => {
  it("renders booking.created with the amount", () => {
    expect(
      eventDescription({ type: "booking.created", payload: { booking_number: "BK-1", total_consideration: 9000000 } })
    ).toBe("Booking BK-1 created for ₹90,00,000");
  });
  it("renders payment.received with the amount", () => {
    expect(eventDescription({ type: "payment.received", payload: { amount: 100000 } })).toBe(
      "Payment of ₹1,00,000 received"
    );
  });
  it("renders progress.updated with from/to", () => {
    expect(
      eventDescription({ type: "progress.updated", payload: { component: "structure", from: "not_started", to: "in_progress" } })
    ).toBe("structure moved from not_started to in_progress");
  });
  it("falls back to a readable sentence for an unmapped type instead of crashing", () => {
    expect(eventDescription({ type: "escalation.raised", payload: {} })).toBe("Escalation raised");
  });
  it("eventFamily extracts the family for filtering", () => {
    expect(eventFamily("sales_handover.accepted")).toBe("sales_handover");
    expect(eventFamily("booking.created")).toBe("booking");
  });
});
