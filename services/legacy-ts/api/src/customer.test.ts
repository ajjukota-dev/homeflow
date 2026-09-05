import { describe, it, expect, beforeAll } from "vitest";
import { initDb, setState } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { getCustomerHome } from "./customer";

const completeInput = {
  applicant: { display_name: "Ravi Menon", phone: "9876500000", pan: "ABCDE1234F" },
  total_consideration: 9800000,
  docs: [
    { type: "PAN card", received: true },
    { type: "Address proof", received: true },
    { type: "Photograph", received: true },
  ],
};

beforeAll(async () => {
  await initDb();
});

describe("My Pranava Home projection (T1 + T3)", () => {
  it("shows coarse stages and friendly windows, no internal fields", async () => {
    const b = await createBooking("u_v108", completeInput); // V108 = mid construction
    await acceptBooking(b.id);
    const home = await getCustomerHome(b.id);
    expect(home).toBeTruthy();
    expect(home!.customer_name).toBe("Ravi Menon");
    expect(home!.stages.length).toBe(5);
    // V108 has structure complete → Foundation + Structure done
    const done = home!.stages.filter((s) => s.state === "done").map((s) => s.label);
    expect(done).toContain("Structure");
    // T3 windows are friendly text, never raw gate enums
    const windows = home!.personalisation.map((p) => p.window);
    for (const w of windows) expect(["Open", "Possible with review", "Window closed"]).toContain(w);
    // no internal fields leaked
    expect(JSON.stringify(home)).not.toMatch(/EXCEPTION_ONLY|HARD_CLOSED|reason|vendor|cost/);
  });

  it("advances a stage when site progress advances", async () => {
    const b = await createBooking("u_v101", completeInput); // V101 = early
    await acceptBooking(b.id);
    const before = await getCustomerHome(b.id);
    expect(before!.stages[0].state).not.toBe("done"); // Foundation not done yet

    await setState("u_v101", "structure", "in_progress");
    const after = await getCustomerHome(b.id);
    expect(after!.stages[0].state).toBe("done"); // Foundation now done
  });
});
