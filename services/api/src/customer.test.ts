import { describe, it, expect, beforeAll } from "vitest";
import { initDb, setState, db } from "./db";
import { createBooking, acceptBooking } from "./bookings";
import { getCustomerHome } from "./customer";
import { superAdminCtx } from "./authz/test-helpers";

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
    const b = await createBooking("u_v108", completeInput, superAdminCtx); // V108 = mid construction
    await acceptBooking(b.id, superAdminCtx);
    const home = await getCustomerHome(b.id, superAdminCtx);
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
    const b = await createBooking("u_v101", completeInput, superAdminCtx); // V101 = early
    await acceptBooking(b.id, superAdminCtx);
    const before = await getCustomerHome(b.id, superAdminCtx);
    expect(before!.stages[0].state).not.toBe("done"); // Foundation not done yet

    await setState("u_v101", "structure", "in_progress");
    const after = await getCustomerHome(b.id, superAdminCtx);
    expect(after!.stages[0].state).toBe("done"); // Foundation now done
  });
});

describe("T2 why-now matches V110's real progress", () => {
  it("states the real component state it reached, never one it hasn't", async () => {
    const rows = await db.query<{ component_code: string; state_code: string }>(
      `SELECT component_code, state_code FROM unit_progress WHERE unit_id = 'u_v110'`
    );
    const stateOf = Object.fromEntries(rows.rows.map((r) => [r.component_code, r.state_code]));

    const home = await getCustomerHome("b_v110", superAdminCtx);
    const byLabel = Object.fromEntries(home!.payments!.schedule.map((s) => [s.milestone_label, s.why_now]));

    expect(byLabel["Structure complete"]).toBe(`Structure ${stateOf.structure} — payment due.`);
    expect(byLabel["MEP first-fix complete"]).toBe(`MEP first-fix ${stateOf.mep_first_fix} — payment due.`);
    expect(byLabel["Flooring laid"]).toBe(`Flooring ${stateOf.flooring} — payment due.`);
    expect(byLabel["Possession"]).toBe("Upcoming — after finishing is verified.");
    for (const sentence of Object.values(byLabel)) expect(sentence).not.toMatch(/_/);
  });
});
