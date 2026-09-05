import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../db";
import { deriveProjectId, assertProjectMatch } from "./derive";

// 04 rule 2, p36 §31.1 — "Any downstream insert carrying project_id must equal the
// Unit's/Booking's project; mismatch -> validation." (p37 §31.5 t2: no manual project tagging.)

beforeAll(async () => {
  await initDb();
});

describe("deriveProjectId (04 rule 2)", () => {
  it("derives from a unit", async () => {
    expect(await deriveProjectId({ unit_id: "u_v101" })).toBe("p_eastcrest");
  });

  it("derives from a booking", async () => {
    expect(await deriveProjectId({ booking_id: "b_v110" })).toBe("p_eastcrest");
  });

  it("throws validation for an unknown unit/booking", async () => {
    await expect(deriveProjectId({ unit_id: "does_not_exist" })).rejects.toMatchObject({ code: "validation" });
  });

  it("assertProjectMatch passes when the supplied id matches or is absent", () => {
    expect(() => assertProjectMatch("p_eastcrest", "p_eastcrest")).not.toThrow();
    expect(() => assertProjectMatch(undefined, "p_eastcrest")).not.toThrow();
  });

  it("assertProjectMatch rejects a mismatched project_id — receipt/demand can't be manually mis-tagged", () => {
    expect(() => assertProjectMatch("p_meadows", "p_eastcrest")).toThrow();
  });
});
