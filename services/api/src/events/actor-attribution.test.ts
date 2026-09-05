import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { ctxWithRoles, customerCtx } from "../authz/test-helpers";
import { createBooking, acceptBooking } from "../bookings";
import { actorFields } from "./append";

// P5 (docs/reports/2026-09-05-branch-review.md's consolidation §6) / R0.6c / SCHEMA.md's
// "Known drift" #5: every appendEvent() call site defaulted to actor_kind='SYSTEM',
// actor_user_id=null even for clearly user-initiated mutations, because ctx.actor was never
// threaded through. This proves the fix on a representative slice, not by re-asserting every
// one of the ~60 call sites individually.

const acceptingUser = ctxWithRoles(["SUPER_ADMIN"], "ALL");
acceptingUser.actor.user_id = "user_p5_accept";

const completeInput = {
  applicant: { display_name: "Ramesh Kumar", phone: "9876501234", pan: "ABCDE1234F" },
  total_consideration: 9500000,
  docs: [
    { type: "PAN card", received: true },
    { type: "Address proof", received: true },
    { type: "Photograph", received: true },
  ],
};

let availableUnits: string[] = [];

beforeAll(async () => {
  await initDb();
  const r = await db.query<{ id: string }>(
    `SELECT id FROM unit WHERE project_id = 'p_eastcrest' AND sale_status = 'available' ORDER BY id LIMIT 2`
  );
  availableUnits = r.rows.map((row) => row.id);
});

describe("actorFields()", () => {
  it("maps a STAFF actor to actor_kind USER", () => {
    expect(actorFields(ctxWithRoles(["SALES"]))).toEqual({ actor_user_id: "test_user", actor_kind: "USER" });
  });
  it("maps a CUSTOMER actor to actor_kind CUSTOMER", () => {
    expect(actorFields(customerCtx("cust_1"))).toEqual({ actor_user_id: "cust_1", actor_kind: "CUSTOMER" });
  });
});

describe("real handlers stamp the acting user on every event they emit", () => {
  it("createBooking + acceptBooking attribute booking.created/customer.created/sales_handover.accepted/unit.sale_status_changed to the real actor, not SYSTEM", async () => {
    const b = await createBooking(availableUnits[0]!, completeInput, acceptingUser);
    await acceptBooking(b!.id, acceptingUser);

    const rows = await db.query<{ type: string; actor_user_id: string | null; actor_kind: string }>(
      `SELECT type, actor_user_id, actor_kind FROM event
        WHERE booking_id = $1
          AND type IN ('booking.created', 'sales_handover.submitted', 'customer.created',
                        'sales_handover.accepted', 'booking.status_changed')`,
      [b!.id]
    );
    expect(rows.rows.length).toBe(5);
    for (const row of rows.rows) {
      expect(row.actor_user_id).toBe("user_p5_accept");
      expect(row.actor_kind).toBe("USER");
    }

    // unit.sale_status_changed carries unit_id, not booking_id (pre-existing shape) — checked separately.
    const unitEvt = await db.query<{ actor_user_id: string | null; actor_kind: string }>(
      `SELECT actor_user_id, actor_kind FROM event WHERE unit_id = $1 AND type = 'unit.sale_status_changed'`,
      [availableUnits[0]!]
    );
    expect(unitEvt.rows.length).toBe(2); // held (createBooking) then booked (acceptBooking)
    for (const row of unitEvt.rows) {
      expect(row.actor_user_id).toBe("user_p5_accept");
      expect(row.actor_kind).toBe("USER");
    }
  });

  it("a subscriber-triggered event (journey.started, fired after commit) still attributes to the user who caused it, not SYSTEM", async () => {
    // journey.started is emitted asynchronously by journey/subscribers.ts's
    // sales_handover.accepted subscriber — it has no live ctx of its own, so it must forward
    // the actor carried on the triggering event rather than defaulting to SYSTEM.
    const b = await createBooking(availableUnits[1]!, { ...completeInput, applicant: { ...completeInput.applicant, phone: "9876501235" } }, acceptingUser);
    await acceptBooking(b!.id, acceptingUser);

    const journeyEvt = await db.query<{ actor_user_id: string | null; actor_kind: string }>(
      `SELECT actor_user_id, actor_kind FROM event WHERE booking_id = $1 AND type = 'journey.started'`,
      [b!.id]
    );
    expect(journeyEvt.rows).toHaveLength(1);
    expect(journeyEvt.rows[0]!.actor_user_id).toBe("user_p5_accept");
    expect(journeyEvt.rows[0]!.actor_kind).toBe("USER");
  });
});
