import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { setProgress } from "./handlers";
import { getCustomerHome } from "./customer";
import {
  listDemands,
  setOverdueReason,
  recordPtp,
} from "./demands";
import { postReceipt } from "./demands-receipts";
import { projectCollections } from "./collections-view";
import { superAdminCtx } from "./authz/test-helpers";

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected a non-null value");
  return value;
}

const completeInput = {
  applicant: { display_name: "Anita Sharma", phone: "9876543210", pan: "ABCDE1234F" },
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

describe("H3 funding setup", () => {
  it("materializes a demand per milestone summing to consideration, project derived", async () => {
    const b = await createBooking("u_v101", completeInput, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const demands = await listDemands(b.id);
    expect(demands.length).toBeGreaterThanOrEqual(5);
    const total = demands.reduce((s, d) => s + d.amount, 0);
    expect(total).toBe(10_000_000);
    expect(demands.every((d) => d.project_id === "p_eastcrest")).toBe(true);
    const bookingAmt = demands.find((d) => d.milestone_key === "booking_token");
    expect(bookingAmt?.status).toBe("due");
    const flooring = demands.find((d) => d.milestone_key === "flooring_milestone");
    expect(flooring?.status).toBe("scheduled");
  });

  it("raises a scheduled demand when the construction trigger is reached (H1→money)", async () => {
    const b = await createBooking("u_v108", completeInput, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const before = await listDemands(b.id);
    const flooring = before.find((d) => d.milestone_key === "flooring_milestone");
    expect(flooring?.status).toBe("scheduled");

    await setProgress("u_v108", "flooring", "complete", superAdminCtx);
    const after = await listDemands(b.id);
    expect(after.find((d) => d.milestone_key === "flooring_milestone")?.status).toBe("due");
  });
});

describe("receipts and PTP", () => {
  it("posts a receipt against the booking's project without asking for project_id", async () => {
    const b = await createBooking("u_v104", {
      ...completeInput,
      applicant: { ...completeInput.applicant, phone: "9876511111" },
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const due = (await listDemands(b.id)).find((d) => d.status === "due")!;
    const receipt = await postReceipt(due.id, {
      amount: due.amount,
      mode: "neft",
      idempotency_key: "rcpt-v104-1",
    }, superAdminCtx);
    expect(receipt.project_id).toBe("p_eastcrest");
    const again = await listDemands(b.id);
    expect(again.find((d) => d.id === due.id)?.status).toBe("settled");
  });

  it("replays the same idempotency key without double-posting", async () => {
    const { db } = await import("./db");
    const bookingId = (
      await db.query<{ id: string }>(`SELECT id FROM booking WHERE unit_id = 'u_v104' AND status = 'active'`)
    ).rows[0].id;
    const demands = await listDemands(bookingId);
    const settled = demands.find((d) => d.status === "settled")!;
    const first = await postReceipt(settled.id, {
      amount: settled.amount,
      mode: "neft",
      idempotency_key: "rcpt-v104-1",
    }, superAdminCtx);
    const second = await postReceipt(settled.id, {
      amount: settled.amount,
      mode: "neft",
      idempotency_key: "rcpt-v104-1",
    }, superAdminCtx);
    expect(second.id).toBe(first.id);
  });

  it("never treats a PTP as an actual receipt", async () => {
    const { db } = await import("./db");
    const bookingId = (
      await db.query<{ id: string }>(`SELECT id FROM booking WHERE unit_id = 'u_v104' AND status = 'active'`)
    ).rows[0].id;
    const open = (await listDemands(bookingId)).find((d) => d.status === "due")!;
    await recordPtp(open.id, { expected_date: "2026-09-20", expected_amount: open.amount }, superAdminCtx);
    const after = (await listDemands(bookingId)).find((d) => d.id === open.id)!;
    expect(after.status).toBe("due");
    expect(after.remaining).toBe(open.amount);
    expect(after.has_active_ptp).toBe(true);
  });
});

describe("receipt amount validation", () => {
  it("rejects non-finite, zero, negative or over-balance amounts, leaving the demand untouched", async () => {
    const { db } = await import("./db");
    const bookingId = (
      await db.query<{ id: string }>(`SELECT id FROM booking WHERE unit_id = 'u_v104' AND status = 'active'`)
    ).rows[0].id;
    const due = (await listDemands(bookingId)).find((d) => d.status === "due" && !d.has_active_ptp)!;

    await expect(postReceipt(due.id, { amount: "abc" }, superAdminCtx)).rejects.toThrow("invalid_amount");
    await expect(postReceipt(due.id, { amount: NaN }, superAdminCtx)).rejects.toThrow("invalid_amount");
    await expect(postReceipt(due.id, { amount: Infinity }, superAdminCtx)).rejects.toThrow("invalid_amount");
    await expect(postReceipt(due.id, { amount: -1 }, superAdminCtx)).rejects.toThrow("invalid_amount");
    await expect(postReceipt(due.id, { amount: 0 }, superAdminCtx)).rejects.toThrow("invalid_amount");
    await expect(postReceipt(due.id, {}, superAdminCtx)).rejects.toThrow("invalid_amount");
    await expect(postReceipt(due.id, { amount: due.amount + 1 }, superAdminCtx)).rejects.toThrow("exceeds_remaining");

    const after = (await listDemands(bookingId)).find((d) => d.id === due.id)!;
    expect(after.status).toBe("due");
    expect(after.remaining).toBe(due.amount);
  });

  it("accepts a numeric string amount and settles the demand when it matches the remaining balance", async () => {
    const { db } = await import("./db");
    const bookingId = (
      await db.query<{ id: string }>(`SELECT id FROM booking WHERE unit_id = 'u_v104' AND status = 'active'`)
    ).rows[0].id;
    const due = (await listDemands(bookingId)).find((d) => d.status === "due" && !d.has_active_ptp)!;

    const receipt = await postReceipt(due.id, { amount: String(due.amount) }, superAdminCtx);
    expect(receipt.amount).toBe(due.amount);

    const after = (await listDemands(bookingId)).find((d) => d.id === due.id)!;
    expect(after.status).toBe("settled");
    expect(after.remaining).toBe(0);
  });
});

describe("true-risk collections workbench", () => {
  it("splits outstanding into the six buckets and never returns only a single number", async () => {
    const view = await projectCollections("p_eastcrest");
    expect(view.outstanding_total).toBeGreaterThan(0);
    expect(view.buckets.DUE).toBeDefined();
    expect(view.buckets.OVERDUE).toBeDefined();
    expect(view.buckets.DISPUTED).toBeDefined();
    expect(view.buckets.LOAN_DEPENDENT).toBeDefined();
    expect(view.buckets.PROMISE_TO_PAY).toBeDefined();
    expect(view.buckets.TRUE_RISK).toBeDefined();
    const bucketSum = Object.values(view.buckets).reduce((s, b) => s + b.amount, 0);
    expect(bucketSum).toBe(view.outstanding_total);
    expect(view.buckets.TRUE_RISK.amount).toBeGreaterThan(0);
    expect(view.buckets.DISPUTED.amount).toBeGreaterThan(0);
    expect(view.buckets.LOAN_DEPENDENT.amount).toBeGreaterThan(0);
    expect(view.buckets.PROMISE_TO_PAY.amount).toBeGreaterThan(0);
  });

  it("requires a structured reason and next action on every overdue / true-risk row", async () => {
    const view = await projectCollections("p_eastcrest");
    const risky = [...view.buckets.OVERDUE.items, ...view.buckets.TRUE_RISK.items];
    expect(risky.length).toBeGreaterThan(0);
    for (const row of risky) {
      expect(row.overdue_reason_code).toBeTruthy();
      expect(row.next_action).toBeTruthy();
    }
  });

  it("rejects setting an unknown overdue reason", async () => {
    const view = await projectCollections("p_eastcrest");
    const row = view.buckets.TRUE_RISK.items[0];
    await expect(setOverdueReason(row.demand_id, "not_a_reason", superAdminCtx)).rejects.toThrow();
  });
});

describe("T2 customer payment view", () => {
  it("shows why-now and running totals without internal risk fields", async () => {
    const { db } = await import("./db");
    const b = await db.query<{ id: string }>(
      `SELECT id FROM booking WHERE unit_id = 'u_v110' AND status = 'active'`
    );
    const home = await getCustomerHome(b.rows[0].id, superAdminCtx);
    const payments = must(home?.payments);
    expect(payments.schedule.length).toBeGreaterThan(0);
    expect(payments.schedule.every((s) => s.why_now.length > 0)).toBe(true);
    expect(payments.paid_total).toBeGreaterThan(0);
    expect(payments.remaining_total).toBeGreaterThan(0);
    const blob = JSON.stringify(payments);
    expect(blob).not.toMatch(/TRUE_RISK|recovery_probability|PTP|loan_dependent/);
  });
});
