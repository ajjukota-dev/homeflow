import { describe, it, expect } from "vitest";
import { autoValidate, freezeSnapshot, readinessCheck, renderDraft, type MergeField } from "./legal";

const MANDATORY: MergeField[] = [
  { key: "applicant_name", label: "Applicant name", source_ref: "booking_applicant.display_name", mandatory: true },
  { key: "pan", label: "PAN", source_ref: "booking_applicant.pan", mandatory: true },
  { key: "unit_number", label: "Unit number", source_ref: "unit.unit_number", mandatory: true },
  { key: "consideration", label: "Consideration", source_ref: "booking.total_consideration", mandatory: true },
];

describe("readinessCheck (H4)", () => {
  it("blocks generation when a mandatory field is missing and links the source record", () => {
    const result = readinessCheck(
      { applicant_name: "Meera Krishnan", pan: null, unit_number: "V111", consideration: "8000000" },
      MANDATORY
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { field: "pan", message: "PAN is missing", source_ref: "booking_applicant.pan" },
    ]);
  });

  it("passes when every mandatory merge field is present", () => {
    const result = readinessCheck(
      {
        applicant_name: "Karthik Iyer",
        pan: "ABCDE1234F",
        unit_number: "V110",
        consideration: "12000000",
      },
      MANDATORY
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("freezeSnapshot + renderDraft", () => {
  it("freezes source values so a later change cannot mutate v1", () => {
    const source = { applicant_name: "Karthik Iyer", consideration: "12000000" };
    const v1 = freezeSnapshot(source);
    source.consideration = "9900000";
    expect(v1.consideration).toBe("12000000");
  });

  it("renders an AOS with zero unresolved tokens from the snapshot", () => {
    const snapshot = {
      applicant_name: "Karthik Iyer",
      pan: "ABCDE1234F",
      unit_number: "V110",
      consideration: "12000000",
    };
    const { body, unresolved } = renderDraft(
      "Agreement for Villa {{unit_number}} with {{applicant_name}} (PAN {{pan}}) for ₹{{consideration}}.",
      snapshot
    );
    expect(unresolved).toEqual([]);
    expect(body).toBe(
      "Agreement for Villa V110 with Karthik Iyer (PAN ABCDE1234F) for ₹12000000."
    );
  });
});

describe("autoValidate", () => {
  it("fails when merge tokens remain or consideration does not match the booking", () => {
    const result = autoValidate({
      body: "Villa {{unit_number}} for ₹12000000",
      snapshot: { consideration: "12000000", unit_number: "V110" },
      consideration: 9_900_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === "unit_number")).toBe(true);
    expect(result.errors.some((e) => e.source_ref === "booking.total_consideration")).toBe(true);
  });
});
