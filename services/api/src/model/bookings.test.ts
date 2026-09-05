import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { cancelBooking, confirmBooking, transferBooking } from "./bookings";
import { superAdminCtx } from "../authz/test-helpers";

beforeAll(async () => {
  await initDb();
});

describe("confirmBooking (04 §API POST /bookings/:id/confirm)", () => {
  it("moves a DRAFT booking to CONFIRMED and emits booking.status_changed", async () => {
    await db.query(
      `INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration,
         completeness_score, code, agreement_value_inr)
       VALUES ('b_draft1','p_eastcrest','u_v101','BK-DRAFT1','draft',5000000,0,'BKG-999001',5000000)`
    );
    await confirmBooking("b_draft1", superAdminCtx);
    const row = await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = 'b_draft1'`);
    expect(row.rows[0].status).toBe("confirmed");
    const events = await db.query<{ payload: { from: string; to: string } }>(
      `SELECT payload FROM event WHERE type = 'booking.status_changed' AND entity_id = 'b_draft1'`
    );
    expect(events.rows[0].payload).toMatchObject({ from: "DRAFT", to: "CONFIRMED" });
  });

  it("rejects confirming a booking that isn't DRAFT", async () => {
    await expect(confirmBooking("b_v110", superAdminCtx)).rejects.toThrow();
  });
});

describe("cancelBooking (04 rule 3 — CANCELLED from any non-terminal, requires a reason)", () => {
  it("requires a reason", async () => {
    await expect(cancelBooking("b_v110", "", superAdminCtx)).rejects.toThrow();
  });

  it("cancels an active booking and releases the unit to AVAILABLE", async () => {
    await db.query(
      `INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration,
         completeness_score, code, agreement_value_inr)
       VALUES ('b_cancel1','p_eastcrest','u_v104','BK-CANCEL1','active',5000000,100,'BKG-999002',5000000)`
    );
    await db.query(`UPDATE unit SET sale_status = 'booked' WHERE id = 'u_v104'`);
    await cancelBooking("b_cancel1", "Customer requested cancellation", superAdminCtx);
    const booking = await db.query<{ status: string; cancellation_reason: string }>(
      `SELECT status, cancellation_reason FROM booking WHERE id = 'b_cancel1'`
    );
    expect(booking.rows[0].status).toBe("cancelled");
    expect(booking.rows[0].cancellation_reason).toContain("cancellation");
    const unit = await db.query<{ sale_status: string }>(`SELECT sale_status FROM unit WHERE id = 'u_v104'`);
    expect(unit.rows[0].sale_status).toBe("available");
  });

  it("rejects cancelling an already-cancelled booking (terminal state)", async () => {
    await expect(cancelBooking("b_cancel1", "again", superAdminCtx)).rejects.toThrow();
  });
});

describe("transferBooking (04 rule 3 — ACTIVE/REGISTERED only, creates a successor)", () => {
  it("creates a successor booking with predecessor_booking_id and marks the original TRANSFERRED", async () => {
    const successorId = await transferBooking("b_v113", "Resale to a new buyer", superAdminCtx);
    const original = await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = 'b_v113'`);
    expect(original.rows[0].status).toBe("transferred");
    const successor = await db.query<{ predecessor_booking_id: string; status: string; unit_id: string }>(
      `SELECT predecessor_booking_id, status, unit_id FROM booking WHERE id = $1`,
      [successorId]
    );
    expect(successor.rows[0].predecessor_booking_id).toBe("b_v113");
    expect(successor.rows[0].status).toBe("active");
    expect(successor.rows[0].unit_id).toBe("u_v113"); // same unit, permanent history preserved

    const transferEvent = await db.query<{ payload: { successor_booking_id: string } }>(
      `SELECT payload FROM event WHERE type = 'booking.transferred' AND entity_id = 'b_v113'`
    );
    expect(transferEvent.rows[0].payload.successor_booking_id).toBe(successorId);
  });

  it("rejects transferring a booking that isn't ACTIVE or REGISTERED", async () => {
    // b_draft1 was confirmed (not activated) by the confirmBooking tests above.
    await expect(transferBooking("b_draft1", "too early", superAdminCtx)).rejects.toThrow();
  });
});
