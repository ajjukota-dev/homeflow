import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { getClearance, updateClearanceChecklist, approveClearance, rejectClearance } from "./financial-clearance";
import { postReceipt } from "./demands-receipts";
import { listDemands } from "./demands";
import { superAdminCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";

// Rule 9 (19-collections-true-risk.md). b_v110 (seed.ts): total_consideration 12,000,000, one
// receipt of 1,200,000 already posted (settled demand) — well under the 0.70 registration_min_pct
// threshold, so it starts blocked on both money and checklist.

const accountsCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_accounts" } };
const managementCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_management", roles: ["MANAGEMENT"] } };
const salesCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_sales", roles: ["SALES"] } };

beforeAll(async () => {
  await initDb();
});

describe("getClearance — computed live, blockers listed until everything is satisfied", () => {
  it("starts PENDING with both checklist and threshold blockers", async () => {
    const c = await getClearance("b_v110", "REGISTRATION", accountsCtx);
    expect(c.status).toBe("PENDING");
    expect(c.blocked_reasons).toContain("ledger_reconciled");
    expect(c.blocked_reasons).toContain("below_threshold");
  });

  it("REGISTRATION and HANDOVER are independent rows (rule 9: 'new purpose row for handover')", async () => {
    const reg = await getClearance("b_v110", "REGISTRATION", accountsCtx);
    const handover = await getClearance("b_v110", "HANDOVER", accountsCtx);
    expect(reg.id).not.toBe(handover.id);
  });
});

describe("approveClearance — requires Accounts lead/Management, checklist complete, and paid >= threshold", () => {
  it("refuses SALES; refuses while blocked; approves once checklist is complete and paid clears the threshold", async () => {
    await expect(approveClearance("b_v110", "REGISTRATION", salesCtx)).rejects.toThrow();
    await expect(approveClearance("b_v110", "REGISTRATION", accountsCtx)).rejects.toThrow(/gate_blocked/);

    // b_v110's total_consideration is 12,000,000 with a 0.70 registration_min_pct threshold
    // (collection_policy, seed.ts), so ≥ 8,400,000 must be paid. seed.ts already posted 1,200,000
    // against d_v110_1; pay the three remaining dated demands (3,600,000 + 2,400,000 + 2,400,000)
    // in full to definitively clear the threshold (paid = 9,600,000, 0.80 >= 0.70) — no ambiguity
    // about whether this test's happy path actually runs.
    const bookingId = (await db.query<{ id: string }>(`SELECT id FROM booking WHERE unit_id = 'u_v110'`)).rows[0].id;
    const openDated = (await listDemands(bookingId)).filter((d) => d.due_date !== null && d.remaining > 0);
    expect(openDated.length).toBe(3); // d_v110_2, d_v110_3, d_v110_4
    for (const d of openDated) {
      await postReceipt(d.id, { amount: d.remaining, idempotency_key: `rcpt-clearance-${d.id}` }, accountsCtx);
    }

    await updateClearanceChecklist(
      "b_v110",
      "REGISTRATION",
      {
        ledger_reconciled: true,
        due_amounts_paid: true,
        tds_verified: true,
        bank_disbursement_applicable: false,
        other_charges_cleared: true,
        exceptions_approved: true,
      },
      accountsCtx
    );

    const view = await getClearance("b_v110", "REGISTRATION", accountsCtx);
    expect(view.blocked_reasons).toEqual([]);
    expect(view.paid_pct).toBeGreaterThanOrEqual(0.7);

    const approved = await approveClearance("b_v110", "REGISTRATION", managementCtx);
    expect(approved.status).toBe("APPROVED");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'clearance.approved' AND entity_id = $1`, [approved.id]);
    expect(evt.rows).toHaveLength(1);

    // Immutable after approval.
    await expect(updateClearanceChecklist("b_v110", "REGISTRATION", { ledger_reconciled: false }, accountsCtx)).rejects.toThrow(/immutable/);
    await expect(approveClearance("b_v110", "REGISTRATION", managementCtx)).rejects.toThrow(/already approved/);
  });
});

describe("rejectClearance", () => {
  it("requires a reason and emits clearance.rejected", async () => {
    await expect(rejectClearance("b_v111", "HANDOVER", "", managementCtx)).rejects.toThrow();
    const rejected = await rejectClearance("b_v111", "HANDOVER", "documents incomplete", managementCtx);
    expect(rejected.status).toBe("REJECTED");
    const evt = await db.query(`SELECT type FROM event WHERE type = 'clearance.rejected' AND entity_id = $1`, [rejected.id]);
    expect(evt.rows).toHaveLength(1);
  });
});
