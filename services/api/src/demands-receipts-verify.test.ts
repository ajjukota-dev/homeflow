import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { listDemands } from "./demands";
import { postReceipt, disputeReceipt, verifyReceipt } from "./demands-receipts";
import { bookingFinance } from "./finance";
import { superAdminCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";

// Rule 4 (19-collections-true-risk.md): receipt.verification tri-state. A DISPUTED receipt stops
// counting toward `remaining`; verifying it (again) re-includes it.

// verifyReceipt writes verified_by, which FKs to "user"(id) — superAdminCtx's user_id ("test_user")
// isn't a real row (same fake-test-user FK gap other Studio-adjacent test files already hit);
// use the real seeded accounts user instead.
const accountsCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_accounts" } };

const completeInput = {
  applicant: { display_name: "Rohan Kapoor", phone: "9876533221", pan: "ABCDE1234F" },
  total_consideration: 10_000_000,
  docs: [
    { type: "PAN card", received: true },
    { type: "Address proof", received: true },
    { type: "Photograph", received: true },
  ],
};

beforeAll(async () => {
  await initDb();
});

describe("disputeReceipt / verifyReceipt (rule 4)", () => {
  it("disputing a receipt removes it from remaining; verifying it again restores it", async () => {
    const b = await createBooking("u_v101", completeInput, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const due = (await listDemands(b.id)).find((d) => d.status === "due")!;
    const partial = Math.floor(due.amount / 2);
    const receipt = await postReceipt(due.id, { amount: partial, idempotency_key: "rcpt-dispute-1" }, superAdminCtx);

    const beforeDispute = (await listDemands(b.id)).find((d) => d.id === due.id)!;
    expect(beforeDispute.remaining).toBe(due.amount - partial);

    const paidBeforeDispute = (await bookingFinance(b.id)).paid;

    await disputeReceipt(receipt.id, "cheque bounced", superAdminCtx);
    const afterDispute = (await listDemands(b.id)).find((d) => d.id === due.id)!;
    expect(afterDispute.remaining).toBe(due.amount); // the disputed receipt no longer counts

    // bookingFinance() (H7) feeds the financial-clearance gate directly — a disputed receipt
    // must stop counting there too, not just in the demand ledger's own remaining.
    const financeAfterDispute = await bookingFinance(b.id);
    expect(financeAfterDispute.paid).toBe(paidBeforeDispute - partial);

    const row = await db.query<{ verification: string; dispute_reason: string }>(
      `SELECT verification, dispute_reason FROM receipt WHERE id = $1`,
      [receipt.id]
    );
    expect(row.rows[0].verification).toBe("DISPUTED");
    expect(row.rows[0].dispute_reason).toBe("cheque bounced");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'payment.disputed' AND entity_id = $1`, [receipt.id]);
    expect(evt.rows).toHaveLength(1);

    await verifyReceipt(receipt.id, accountsCtx);
    const afterVerify = (await listDemands(b.id)).find((d) => d.id === due.id)!;
    expect(afterVerify.remaining).toBe(due.amount - partial); // counts again

    const row2 = await db.query<{ verification: string; dispute_reason: string | null }>(
      `SELECT verification, dispute_reason FROM receipt WHERE id = $1`,
      [receipt.id]
    );
    expect(row2.rows[0].verification).toBe("VERIFIED");
    expect(row2.rows[0].dispute_reason).toBeNull();
  });

  it("refuses to dispute an already-disputed receipt, and refuses an empty reason", async () => {
    const b = await createBooking("u_v108", {
      ...completeInput,
      applicant: { ...completeInput.applicant, phone: "9876533222" },
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const due = (await listDemands(b.id)).find((d) => d.status === "due")!;
    const receipt = await postReceipt(due.id, { amount: due.amount, idempotency_key: "rcpt-dispute-2" }, superAdminCtx);

    await expect(disputeReceipt(receipt.id, "", superAdminCtx)).rejects.toThrow("reason_required");
    await disputeReceipt(receipt.id, "duplicate entry", superAdminCtx);
    await expect(disputeReceipt(receipt.id, "again", superAdminCtx)).rejects.toThrow("already_disputed");
  });
});
