import { describe, it, expect } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  assertBookingTransition,
  isTerminalBookingStatus,
  toDbBookingStatus,
  toSpecBookingStatus,
} from "./status";

// 04 rule 3 — the exact transition graph verbatim from the spec.

describe("booking status vocabulary + transitions (04 rule 3)", () => {
  it("round-trips every status through the DB<->spec translation", () => {
    for (const s of BOOKING_STATUSES) {
      expect(toSpecBookingStatus(toDbBookingStatus(s))).toBe(s);
    }
  });

  it("allows DRAFT -> CONFIRMED -> SUBMITTED_TO_CRM -> CRM_ACCEPTED -> ACTIVE -> REGISTERED -> HANDED_OVER", () => {
    expect(() => assertBookingTransition("DRAFT", "CONFIRMED")).not.toThrow();
    expect(() => assertBookingTransition("CONFIRMED", "SUBMITTED_TO_CRM")).not.toThrow();
    expect(() => assertBookingTransition("SUBMITTED_TO_CRM", "CRM_ACCEPTED")).not.toThrow();
    expect(() => assertBookingTransition("CRM_ACCEPTED", "ACTIVE")).not.toThrow();
    expect(() => assertBookingTransition("ACTIVE", "REGISTERED")).not.toThrow();
    expect(() => assertBookingTransition("REGISTERED", "HANDED_OVER")).not.toThrow();
  });

  it("allows SUBMITTED_TO_CRM -> RETURNED -> SUBMITTED_TO_CRM (the return loop)", () => {
    expect(() => assertBookingTransition("SUBMITTED_TO_CRM", "RETURNED")).not.toThrow();
    expect(() => assertBookingTransition("RETURNED", "SUBMITTED_TO_CRM")).not.toThrow();
  });

  it("allows CANCELLED from every non-terminal state", () => {
    for (const s of BOOKING_STATUSES) {
      if (isTerminalBookingStatus(s)) continue;
      expect(() => assertBookingTransition(s, "CANCELLED")).not.toThrow();
    }
  });

  it("allows TRANSFERRED only from ACTIVE or REGISTERED", () => {
    expect(() => assertBookingTransition("ACTIVE", "TRANSFERRED")).not.toThrow();
    expect(() => assertBookingTransition("REGISTERED", "TRANSFERRED")).not.toThrow();
    expect(() => assertBookingTransition("SUBMITTED_TO_CRM", "TRANSFERRED")).toThrow();
    expect(() => assertBookingTransition("DRAFT", "TRANSFERRED")).toThrow();
  });

  it("rejects a skip-ahead transition", () => {
    expect(() => assertBookingTransition("DRAFT", "ACTIVE")).toThrow();
    expect(() => assertBookingTransition("SUBMITTED_TO_CRM", "HANDED_OVER")).toThrow();
  });

  it("terminal states have no outgoing transitions", () => {
    for (const s of ["HANDED_OVER", "CANCELLED", "TRANSFERRED"] as const) {
      expect(BOOKING_TRANSITIONS[s]).toEqual([]);
      expect(isTerminalBookingStatus(s)).toBe(true);
    }
  });
});
