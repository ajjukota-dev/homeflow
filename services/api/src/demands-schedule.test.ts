import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { setProgress } from "./handlers";
import { getCustomerHome } from "./customer";
import { listDemands, today } from "./demands";
import { postReceipt } from "./demands-receipts";
import { projectCollections } from "./collections-view";
import { superAdminCtx } from "./authz/test-helpers";

// H3 — a scheduled demand carries no due_date until its construction trigger fires
// (accounts/spec.md H3; T2 in customer-transparency.md must show "Upcoming", never a stamped date).

const completeInput = {
  applicant: { display_name: "Deepa Menon", phone: "9876500001", pan: "ABCDE1234F" },
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

describe("setupFunding — no date stamped on an unmet trigger", () => {
  it("leaves scheduled demands with due_date null and only dates the no-trigger demand", async () => {
    // u_v101 starts with every component not_started — no trigger has fired.
    const b = await createBooking("u_v101", completeInput, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const demands = await listDemands(b.id);

    const booking = demands.find((d) => d.milestone_key === "booking_token")!;
    expect(booking.status).toBe("due");
    expect(booking.due_date).toBe(today());

    const scheduled = demands.filter((d) => d.status === "scheduled");
    expect(scheduled.length).toBeGreaterThan(0);
    for (const d of scheduled) {
      expect(d.due_date).toBeNull();
    }
  });
});

describe("raiseDemandsForUnit — dates only the demand whose trigger just fired", () => {
  it("stamps today's date on the newly-due demand, leaves other scheduled demands null", async () => {
    // u_v108 is seeded with structure already complete, so its structure milestone is
    // already due (dated at setupFunding); mep/flooring/possession are still scheduled.
    const b = await createBooking("u_v108", completeInput, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const before = await listDemands(b.id);
    const mep = before.find((d) => d.milestone_key === "mep_milestone")!;
    const flooring = before.find((d) => d.milestone_key === "flooring_milestone")!;
    expect(mep.status).toBe("scheduled");
    expect(mep.due_date).toBeNull();
    expect(flooring.due_date).toBeNull();

    await setProgress("u_v108", "mep_first_fix", "complete", superAdminCtx);

    const after = await listDemands(b.id);
    const mepAfter = after.find((d) => d.milestone_key === "mep_milestone")!;
    const flooringAfter = after.find((d) => d.milestone_key === "flooring_milestone")!;
    expect(mepAfter.status).toBe("due");
    expect(mepAfter.due_date).toBe(today());
    expect(flooringAfter.status).toBe("scheduled");
    expect(flooringAfter.due_date).toBeNull();
  });
});

describe("T2 customer payment view — scheduled demand carries due_date: null", () => {
  it("shows null due_date and 'Upcoming' status without shrinking remaining_total", async () => {
    const b = await createBooking("u_v104", {
      ...completeInput,
      applicant: { ...completeInput.applicant, phone: "9876500002" },
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    const home = await getCustomerHome(b.id, superAdminCtx);
    const payments = home!.payments!;

    const scheduledLine = payments.schedule.find((s) => s.status === "Upcoming")!;
    expect(scheduledLine).toBeDefined();
    expect(scheduledLine.due_date).toBeNull();

    // remaining_total is total consideration minus paid — unaffected by whether a
    // scheduled demand has a due_date, since it was never keyed off due_date.
    const expectedRemaining = 10_000_000 - payments.paid_total;
    expect(payments.remaining_total).toBe(expectedRemaining);
  });
});

describe("a receipt against a scheduled (undated) demand never vanishes from collections", () => {
  it("stays visible with its balance once nothing sets a due_date", async () => {
    // Nothing stops a receipt landing on a scheduled demand (postReceipt only checks
    // the amount against the remaining balance) — its due_date stays null, so the
    // true-risk engine must not treat "no date yet" as "nothing owed".
    const { db } = await import("./db");
    const bookingId = (
      await db.query<{ id: string }>(`SELECT id FROM booking WHERE unit_id = 'u_v101' AND status = 'active'`)
    ).rows[0].id;
    const scheduled = (await listDemands(bookingId)).find((d) => d.status === "scheduled")!;
    expect(scheduled.due_date).toBeNull();

    const partial = Math.floor(scheduled.amount / 2);
    await postReceipt(scheduled.id, { amount: partial, idempotency_key: "rcpt-v101-scheduled-partial" }, superAdminCtx);

    const updated = (await listDemands(bookingId)).find((d) => d.id === scheduled.id)!;
    expect(updated.status).toBe("part_paid");
    expect(updated.due_date).toBeNull();
    expect(updated.remaining).toBeGreaterThan(0);

    const view = await projectCollections("p_eastcrest");
    const found = Object.values(view.buckets)
      .flatMap((b) => b.items)
      .find((i) => i.demand_id === scheduled.id);
    expect(found).toBeDefined();
    expect(found?.amount).toBe(updated.remaining);
    expect(found?.bucket).toBe("DUE");
  });
});
