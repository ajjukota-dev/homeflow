import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { suggestTdsApplicability, upsertTdsRecord, verifyTds, rejectTds } from "./tds";
import { superAdminCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";

// Rule 7 (19-collections-true-risk.md): TDS suggestion (§194IA, ≥ ₹50,00,000) is advisory only;
// Accounts records the human decision.

const accountsCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_accounts" } };

let lowValueBookingId: string;

const smallInput = {
  applicant: { display_name: "Tanvi Joshi", phone: "9876555001", pan: "ABCDE1234F" },
  total_consideration: 3_000_000, // below the 50,00,000 §194IA threshold
  docs: [
    { type: "PAN card", received: true },
    { type: "Address proof", received: true },
    { type: "Photograph", received: true },
  ],
};

beforeAll(async () => {
  await initDb();
  const b = await createBooking("u_v101", smallInput, superAdminCtx);
  await acceptBooking(b.id, superAdminCtx);
  lowValueBookingId = b.id;
});

describe("suggestTdsApplicability — a suggestion, never a write", () => {
  it("suggests APPLICABLE at or above the §194IA threshold", async () => {
    // b_v110 (seed.ts): agreement_value_inr = 12,000,000 >= 50,00,000
    const s = await suggestTdsApplicability("b_v110");
    expect(s.suggested).toBe("APPLICABLE");
    expect(s.suggested_amount).toBe(120_000); // 1% of 1,20,00,000
  });

  it("suggests NOT_APPLICABLE below the threshold", async () => {
    const s = await suggestTdsApplicability(lowValueBookingId);
    expect(s.suggested).toBe("NOT_APPLICABLE");
    expect(s.suggested_amount).toBeNull();
  });
});

describe("upsertTdsRecord / verifyTds / rejectTds", () => {
  it("requires a reason when recording NOT_APPLICABLE", async () => {
    await expect(
      upsertTdsRecord(lowValueBookingId, { applicability: "NOT_APPLICABLE" }, accountsCtx)
    ).rejects.toThrow("na_reason_required");
  });

  it("records NOT_APPLICABLE with a reason as NOT_REQUIRED, no verification needed", async () => {
    const r = await upsertTdsRecord(lowValueBookingId, { applicability: "NOT_APPLICABLE", na_reason: "below threshold" }, accountsCtx);
    expect(r.status).toBe("NOT_REQUIRED");
  });

  it("verify requires all fields, then marks VERIFIED and emits tds.verified", async () => {
    const r = await upsertTdsRecord("b_v110", { applicability: "APPLICABLE", amount: 120_000 }, accountsCtx);
    expect(r.status).toBe("PENDING");

    await expect(
      verifyTds(r.id, { challan_number: "", challan_date: "2026-09-01", pan: "ABCDE1234F", file_id: "f1" }, accountsCtx)
    ).rejects.toThrow("all_fields_required");

    const verified = await verifyTds(r.id, { challan_number: "CH123", challan_date: "2026-09-01", pan: "ABCDE1234F", file_id: "f1" }, accountsCtx);
    expect(verified.status).toBe("VERIFIED");
    expect(verified.challan_number).toBe("CH123");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'tds.verified' AND entity_id = $1`, [r.id]);
    expect(evt.rows).toHaveLength(1);
  });

  it("rejects a TDS record with a reason and emits tds.rejected", async () => {
    const r = await upsertTdsRecord("b_v110", { applicability: "APPLICABLE", amount: 50_000, demand_id: null }, accountsCtx);
    const rejected = await rejectTds(r.id, "wrong PAN on challan", accountsCtx);
    expect(rejected.status).toBe("REJECTED");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'tds.rejected' AND entity_id = $1`, [r.id]);
    expect(evt.rows).toHaveLength(1);
  });
});
