import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { generateDocument, approveDocument, executeDocument, completeRegistration, listLegalQueue } from "./legal-docs";
import { unitReadiness, verifyComponent, completeHandover, handoverForBooking } from "./qa";
import { serviceHistory, closeWarranty, projectWarranty, captureCheckin } from "./warranty";
import { getCustomerHome } from "./customer";
import { controlTower, actIntervention } from "./management/interventions";
import { superAdminCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";

// actIntervention's createAction now FKs `created_by` to a real "user" row (27's own regression
// fix for PR #8's acted_by=null) — the shared superAdminCtx's synthetic id isn't one, same
// convention commitments/core.test.ts already established. Scoped to just this describe block
// so the rest of this file's many superAdminCtx call sites are untouched.
const realSuperAdminCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_superadmin" } };

const completeInput = {
  applicant: { display_name: "Ravi Menon", phone: "9876500099", pan: "ABCDE1234F" },
  total_consideration: 9_800_000,
  docs: [
    { type: "PAN card", received: true },
    { type: "Address proof", received: true },
    { type: "Photograph", received: true },
  ],
};

beforeAll(async () => {
  await initDb();
});

describe("Legal factory (H4)", () => {
  it("blocks generation when PAN is missing and points at the source record", async () => {
    const b = await createBooking("u_v101", completeInput, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    await db.query(`UPDATE booking_applicant SET pan = NULL WHERE booking_id = $1`, [b.id]);
    try {
      await generateDocument(b.id, "AOS", superAdminCtx);
      throw new Error("should have blocked");
    } catch (e) {
      const err = e as Error & { errors?: { source_ref: string; field: string }[] };
      expect(err.message).toBe("validation_failed");
      expect(err.errors?.[0].field).toBe("pan");
      expect(err.errors?.[0].source_ref).toBe("booking_applicant.pan");
    }
  });

  it("freezes v1 when consideration later changes, and v2 uses a new snapshot", async () => {
    const b = await createBooking("u_v108", {
      ...completeInput,
      applicant: { ...completeInput.applicant, phone: "9876500088" },
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const v1 = await generateDocument(b.id, "AOS", superAdminCtx);
    expect(v1.status).toBe("draft");
    expect(v1.body_rendered).toContain("Ravi Menon");
    expect(v1.body_rendered).not.toMatch(/\{\{/);
    await db.query(`UPDATE booking SET total_consideration = 8800000 WHERE id = $1`, [b.id]);
    const v2 = await generateDocument(b.id, "AOS", superAdminCtx);
    expect(v2.version).toBe(2);
    const snap1 = typeof v1.snapshot === "string" ? JSON.parse(v1.snapshot) : v1.snapshot;
    expect(snap1.consideration).toBe("9800000");
    const snap2 = typeof v2.snapshot === "string" ? JSON.parse(v2.snapshot) : v2.snapshot;
    expect(snap2.consideration).toBe("8800000");
  });
});

describe("Registration (H7 / H8)", () => {
  it("refuses H8 when financial clearance has not been reached", async () => {
    await expect(completeRegistration("b_v110", "SRO/X", superAdminCtx)).rejects.toThrow(/below_registration_threshold/);
  });

  it("lists Karthik as executed and Meera as still needing an AOS", async () => {
    const queue = await listLegalQueue("p_eastcrest", superAdminCtx);
    const karthik = queue.find((r) => r.booking_id === "b_v110");
    const meera = queue.find((r) => r.booking_id === "b_v111");
    expect(karthik?.document?.status).toBe("executed");
    expect(meera?.document).toBeNull();
    expect(karthik?.financial.cleared).toBe(false);
  });
});

describe("QA readiness and H9 / H12", () => {
  it("does not treat site-complete structure on V110 as QA-verified flooring", async () => {
    const ready = await unitReadiness("u_v110");
    const flooring = ready.components.find((c) => c.code === "flooring");
    expect(flooring?.qa_verified).toBe(false);
    expect(ready.qa_approved).toBe(false);
  });

  it("records independent QA verification with evidence", async () => {
    const after = await verifyComponent("u_v110", "mep_first_fix", "Pressure test photo attached", superAdminCtx);
    expect(after.components.find((c) => c.code === "mep_first_fix")?.qa_verified).toBe(true);
  });

  it("blocks handover when a critical snag is open", async () => {
    const view = await handoverForBooking("b_v111");
    expect(view.eligible).toBe(false);
    expect(view.blockers.some((b) => /critical snag/i.test(b.reason))).toBe(true);
    await expect(completeHandover("b_v111", superAdminCtx)).rejects.toThrow("handover_not_eligible");
  });

  it("completes handover on V112 and opens a policy-length DLP with check-ins (H12)", async () => {
    const before = await handoverForBooking("b_v112");
    expect(before.eligible).toBe(true);
    await completeHandover("b_v112", superAdminCtx);
    const after = await handoverForBooking("b_v112");
    expect(after.lifecycle).toBe("completed");
    const warranty = await projectWarranty("p_eastcrest", superAdminCtx);
    const dlp = warranty.windows.find((w: { booking_id: string }) => w.booking_id === "b_v112");
    expect(dlp?.policy_months).toBe(12);
    expect(warranty.checkins.filter((c: { booking_id: string }) => c.booking_id === "b_v112").map((c: { day: number }) => c.day)).toEqual([
      7, 30, 90,
    ]);
    const history = await serviceHistory("u_v112", superAdminCtx);
    expect(history.some((h: { event_type: string }) => h.event_type === "handover.completed")).toBe(true);
  });
});

describe("Post-handover", () => {
  it("keeps service history on the unit and closes a covered case as non-chargeable", async () => {
    const history = await serviceHistory("u_v113", superAdminCtx);
    expect(history.length).toBeGreaterThanOrEqual(2);
    const closed = await closeWarranty("w_v113_1", superAdminCtx);
    expect(Number(closed.chargeable_amount)).toBe(0);
    expect(closed.status).toBe("closed");
    const after = await serviceHistory("u_v113", superAdminCtx);
    expect(after.length).toBeGreaterThan(history.length);
  });

  // post-handover/spec.md §2.2 defines satisfaction_score but not its range; 1-5 assumed (CSAT), see PR body
  it("rejects an out-of-range or non-numeric satisfaction score and writes nothing", async () => {
    for (const bad of [0, 6, 99, Number.NaN]) {
      const err = (await captureCheckin("ci_v113_30", bad, superAdminCtx).catch((e) => e)) as Error & { errors?: { code: string; field: string; message: string }[] };
      expect(err.message).toBe("validation_failed");
      expect(err.errors?.[0]).toEqual({ code: "validation", field: "satisfaction_score", message: "must be an integer from 1 to 5" });
    }
    const unchanged = await db.query<{ status: string; satisfaction_score: number | null }>(
      `SELECT status, satisfaction_score FROM checkin_record WHERE id = $1`,
      ["ci_v113_30"]
    );
    expect(unchanged.rows[0].status).toBe("scheduled");
    expect(unchanged.rows[0].satisfaction_score).toBeNull();
  });

  it("throws not_found capturing an unknown check-in id", async () => {
    await expect(captureCheckin("does-not-exist", 4, superAdminCtx)).rejects.toThrow("not_found");
  });

  it("captures a valid satisfaction score at the 1-5 scale boundaries", async () => {
    const low = await captureCheckin("ci_v113_7", 1, superAdminCtx);
    expect(low.status).toBe("captured");
    expect(low.satisfaction_score).toBe(1);
    const high = await captureCheckin("ci_v113_90", 5, superAdminCtx);
    expect(high.status).toBe("captured");
    expect(high.satisfaction_score).toBe(5);
  });
});

describe("Customer T4 T5 T6", () => {
  it("shows Karthik his RERA corner, passport item, and keys window without internal leaks", async () => {
    const home = await getCustomerHome("b_v110", superAdminCtx);
    expect(home?.legal.rera_reg_no).toMatch(/RERA/);
    expect(home?.legal.my_documents[0].name).toBe("Agreement for sale");
    expect(home?.passport.some((p) => p.paint_tile_code === "Warm Sand 04")).toBe(true);
    expect(home?.keys.confidence_label).toBe("Firming up");
    expect(JSON.stringify(home)).not.toMatch(
      /EXCEPTION_ONLY|HARD_CLOSED|TRUE_RISK|vendor|critical snag|readiness_value/
    );
  });
});

describe("Control Tower", () => {
  it("returns exactly five decision packs, one per category", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    expect(tower.interventions).toHaveLength(5);
    expect(tower.interventions.map((i) => i.category)).toEqual([
      "customer",
      "cash",
      "handover",
      "reputation",
      "margin",
    ]);
    for (const i of tower.interventions) {
      expect(i.decision_pack.recommended_decision).toBeTruthy();
      expect(i.decision_pack.what_happened).toBeTruthy();
    }
    const acted = await actIntervention(tower.interventions[0].id, realSuperAdminCtx);
    expect(acted.status).toBe("acted");
  });
});

describe("approve and execute", () => {
  it("moves a draft AOS to executed with a checksum", async () => {
    const b = await createBooking("u_v104", {
      ...completeInput,
      applicant: { ...completeInput.applicant, phone: "9876500077" },
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const draft = await generateDocument(b.id, "AOS", superAdminCtx);
    const approved = await approveDocument(draft.id, superAdminCtx);
    expect(approved.status).toBe("legal_approved");
    const executed = await executeDocument(approved.id, superAdminCtx);
    expect(executed.status).toBe("executed");
    expect(executed.checksum).toBeTruthy();
  });
});
