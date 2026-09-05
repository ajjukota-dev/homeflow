import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { listDemands } from "./demands";
import { requestWaiver, approveWaiver, rejectWaiver, listWaivers } from "./waivers";
import { createApprovalRule } from "./approvals/matrix";
import { superAdminCtx } from "./authz/test-helpers";
import type { Ctx } from "./authz/types";

// Rule 8 (19-collections-true-risk.md) — the approval matrix's (25) first real consumer.

const accountsCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_accounts" } };
const managementCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_management", roles: ["MANAGEMENT"] } };

const completeInput = {
  applicant: { display_name: "Sunita Rao", phone: "9876544321", pan: "ABCDE1234F" },
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

describe("requestWaiver — fails closed when no band is configured (advisor review: do not seed a happy path)", () => {
  it("throws before any WAIVER band exists in approval_authority_rule", async () => {
    const b = await createBooking("u_v101", completeInput, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const due = (await listDemands(b.id)).find((d) => d.status === "due")!;

    await expect(
      requestWaiver({ booking_id: b.id, demand_id: due.id, kind: "LATE_FEE", amount: 1000, reason: "goodwill" }, accountsCtx)
    ).rejects.toThrow(/no approval_authority_rule covers/);
  });
});

describe("requestWaiver / approveWaiver / rejectWaiver — once a band is configured", () => {
  it("requests, blocks self-approval and the wrong role, then approves and reduces the demand's remaining balance", async () => {
    await createApprovalRule(
      { domain: "WAIVER", metric: "INR", min: 0, max: 100000, approver_role: "MANAGEMENT", project_id: null, effective_from: "2020-01-01" },
      managementCtx
    );

    const b = await createBooking("u_v108", {
      ...completeInput,
      applicant: { ...completeInput.applicant, phone: "9876544322" },
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const due = (await listDemands(b.id)).find((d) => d.status === "due")!;
    const originalAmount = due.amount;
    const originalRemaining = due.remaining;

    const waiver = await requestWaiver({ booking_id: b.id, demand_id: due.id, kind: "LATE_FEE", amount: 5000, reason: "first late payment, goodwill" }, accountsCtx);
    expect(waiver.status).toBe("REQUESTED");
    expect(waiver.approval_rule_id).toBeTruthy();

    const requestedEvt = await db.query(`SELECT type FROM event WHERE type = 'waiver.requested' AND entity_id = $1`, [waiver.id]);
    expect(requestedEvt.rows).toHaveLength(1);

    // The requester can never be an approver (25 rule 2 / 19 rule 8).
    await expect(approveWaiver(waiver.id, accountsCtx)).rejects.toThrow(/requester cannot approve/);

    // A role that isn't the configured approver_role (MANAGEMENT) is refused too.
    const wrongRoleCtx: Ctx = { actor: { ...superAdminCtx.actor, user_id: "user_sales", roles: ["SALES"] } };
    await expect(approveWaiver(waiver.id, wrongRoleCtx)).rejects.toThrow();

    const approved = await approveWaiver(waiver.id, managementCtx);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approved_by).toBe("user_management");

    const afterDemand = (await listDemands(b.id)).find((d) => d.id === due.id)!;
    expect(afterDemand.amount).toBe(originalAmount); // amount is untouched — the schedule still sums to total_consideration
    expect(afterDemand.remaining).toBe(originalRemaining - 5000); // rule 8: "reduce outstanding"

    const evt = await db.query(`SELECT type FROM event WHERE type = 'waiver.approved' AND entity_id = $1`, [waiver.id]);
    expect(evt.rows).toHaveLength(1);

    const list = await listWaivers(b.id, accountsCtx);
    expect(list.find((w) => w.id === waiver.id)?.status).toBe("APPROVED");
  });

  it("rejects a waiver with a reason and emits waiver.rejected", async () => {
    const b = await createBooking("u_v104", {
      ...completeInput,
      applicant: { ...completeInput.applicant, phone: "9876544323" },
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const due = (await listDemands(b.id)).find((d) => d.status === "due")!;

    const waiver = await requestWaiver({ booking_id: b.id, demand_id: due.id, kind: "OTHER_CHARGE", amount: 2000, reason: "requested" }, accountsCtx);
    const rejected = await rejectWaiver(waiver.id, "not justified", managementCtx);
    expect(rejected.status).toBe("REJECTED");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'waiver.rejected' AND entity_id = $1`, [waiver.id]);
    expect(evt.rows).toHaveLength(1);
  });
});
