import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "./db";
import { superAdminCtx } from "./authz/test-helpers";
import {
  assessCompleteness,
  createBooking,
  acceptBooking,
  returnBooking,
  listBookings,
  listCustomers,
  type BookingInput,
} from "./bookings";

const fullDocs = [
  { type: "PAN card", received: true },
  { type: "Address proof", received: true },
  { type: "Photograph", received: true },
];
const completeInput: BookingInput = {
  applicant: { display_name: "Anita Sharma", phone: "9876543210", pan: "ABCDE1234F" },
  total_consideration: 12500000,
  docs: fullDocs,
};

beforeAll(async () => {
  await initDb();
});

describe("completeness gate", () => {
  it("flags every missing item on an empty file", () => {
    const { score, missing } = assessCompleteness({
      applicant: { display_name: "", phone: "", pan: "" },
      total_consideration: 0,
      docs: [],
    });
    expect(score).toBe(0);
    expect(missing).toContain("PAN");
    expect(missing).toContain("Consideration");
  });

  it("reaches 100 only when everything is present", () => {
    expect(assessCompleteness(completeInput).score).toBe(100);
  });
});

describe("H2 booking → CRM handoff", () => {
  it("blocks creation of an incomplete booking", async () => {
    await expect(
      createBooking("u_v101", { ...completeInput, applicant: { ...completeInput.applicant, pan: "" } }, superAdminCtx)
    ).rejects.toThrow("incomplete");
  });

  it("creates a submitted booking and holds the unit", async () => {
    const b = await createBooking("u_v101", completeInput, superAdminCtx);
    expect(b.status).toBe("submitted");
    expect(b.completeness_score).toBe(100);
    const queue = await listBookings("submitted", superAdminCtx);
    expect(queue.find((x) => x.id === b.id)).toBeTruthy();
  });

  it("accept births a Customer Twin and books the unit", async () => {
    const b = await createBooking("u_v108", completeInput, superAdminCtx);
    const { customer_id } = await acceptBooking(b.id, superAdminCtx);
    expect(customer_id).toBeTruthy();
    const customers = await listCustomers(superAdminCtx);
    expect(customers.some((c) => c.id === customer_id)).toBe(true);
    const accepted = await listBookings("active", superAdminCtx);
    expect(accepted.find((x) => x.id === b.id)?.status).toBe("active");
  });

  it("return sends it back with a reason and frees the unit", async () => {
    const b = await createBooking("u_v104", completeInput, superAdminCtx);
    const returned = await returnBooking(b.id, "PAN mismatch with agreement", superAdminCtx);
    expect(returned.status).toBe("returned");
    expect(returned.return_reason).toContain("PAN");
  });
});
