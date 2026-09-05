import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { listApplicants, setApplicants } from "./applicants";

beforeAll(async () => {
  await initDb();
});

describe("booking applicants (04 rule 4, §API PUT /bookings/:id/applicants)", () => {
  it("seeded booking already has exactly one PRIMARY", async () => {
    const applicants = await listApplicants("b_v110");
    expect(applicants.filter((a) => a.role === "PRIMARY")).toHaveLength(1);
  });

  it("adds a co-applicant and emits applicant.added", async () => {
    const existing = await listApplicants("b_v111");
    const result = await setApplicants("b_v111", [
      { ...existing[0], role: "PRIMARY" },
      { display_name: "Suresh Krishnan", role: "CO_APPLICANT", ownership_pct: undefined },
    ]);
    expect(result).toHaveLength(2);
    expect(result.some((a) => a.role === "CO_APPLICANT" && a.display_name === "Suresh Krishnan")).toBe(true);
    const events = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM event WHERE type = 'applicant.added' AND booking_id = 'b_v111'`
    );
    expect(events.rows[0].n).toBe(1);
  });

  it("removes an applicant and emits applicant.removed", async () => {
    const existing = await listApplicants("b_v111");
    const primary = existing.find((a) => a.role === "PRIMARY")!;
    await setApplicants("b_v111", [primary]);
    const after = await listApplicants("b_v111");
    expect(after).toHaveLength(1);
    const events = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM event WHERE type = 'applicant.removed' AND booking_id = 'b_v111'`
    );
    expect(events.rows[0].n).toBe(1);
  });

  it("rejects zero or two PRIMARY applicants", async () => {
    const existing = await listApplicants("b_v110");
    await expect(setApplicants("b_v110", [])).rejects.toThrow();
    await expect(
      setApplicants("b_v110", [
        { ...existing[0], role: "PRIMARY" },
        { display_name: "Second Primary", role: "PRIMARY" },
      ])
    ).rejects.toThrow();
  });

  it("rejects more than the configured max applicants", async () => {
    const existing = await listApplicants("b_v112");
    await expect(
      setApplicants("b_v112", [
        { ...existing[0], role: "PRIMARY" },
        { display_name: "A", role: "CO_APPLICANT" },
        { display_name: "B", role: "CO_APPLICANT" },
        { display_name: "C", role: "CO_APPLICANT" },
        { display_name: "D", role: "CO_APPLICANT" },
      ])
    ).rejects.toThrow();
  });

  it("rejects ownership_pct that doesn't sum to 100", async () => {
    const existing = await listApplicants("b_v113");
    await expect(
      setApplicants("b_v113", [
        { ...existing[0], role: "PRIMARY", ownership_pct: 60 },
        { display_name: "Co-owner", role: "CO_APPLICANT", ownership_pct: 30 },
      ])
    ).rejects.toThrow();
  });
});
