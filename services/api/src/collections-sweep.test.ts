import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { sweepOverdueDemands } from "./collections-sweep";

// Rule 2, first half (19-collections-true-risk.md): "Every OVERDUE demand must carry a
// reason_code within 2 working days; missing -> action 'Record overdue reason'."

beforeAll(async () => {
  await initDb();
});

describe("sweepOverdueDemands", () => {
  it("creates a 'Record overdue reason' action once a demand has been overdue past the 2-working-day grace window", async () => {
    // A fresh demand, overdue 10 calendar days (well past 2 working days), no reason yet.
    await db.query(
      `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, due_date, status)
       VALUES ('d_sweep_1','b_v110','p_eastcrest','sweep_test','Sweep test milestone',99,500000,CURRENT_DATE - 10,'due')`
    );
    const created = await sweepOverdueDemands();
    const mine = created.find((c) => c.demand_id === "d_sweep_1");
    expect(mine).toBeDefined();

    const action = await db.query<{ owner_role: string; title: string; priority: string }>(
      `SELECT owner_role, title, priority FROM action WHERE id = $1`,
      [mine!.action_id]
    );
    expect(action.rows[0].owner_role).toBe("ACCOUNTS");
    expect(action.rows[0].priority).toBe("HIGH");
    expect(action.rows[0].title).toContain("Record overdue reason");
  });

  it("does not flag a demand still inside the 2-working-day grace window", async () => {
    await db.query(
      `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, due_date, status)
       VALUES ('d_sweep_2','b_v110','p_eastcrest','sweep_test_2','Sweep grace test',99,500000,CURRENT_DATE,'due')`
    );
    const created = await sweepOverdueDemands();
    expect(created.find((c) => c.demand_id === "d_sweep_2")).toBeUndefined();
  });

  it("does not create a second reminder while one is already open", async () => {
    const first = await sweepOverdueDemands();
    expect(first.find((c) => c.demand_id === "d_sweep_1")).toBeUndefined(); // already created above, still open
  });

  it("never flags a demand that already has a reason recorded", async () => {
    // d_v110_4 (seed.ts) is overdue 70 days but already carries overdue_reason_code='unresponsive'.
    const created = await sweepOverdueDemands();
    expect(created.find((c) => c.demand_id === "d_v110_4")).toBeUndefined();
  });
});
