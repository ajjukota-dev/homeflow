import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { getForecast } from "../forecast/core";
import { runOnce, type SchedulerDeps } from "./jobs";

// Phase 3: one runOnce(asOf) calls the four existing sweeps. asOf is injected — no sleep.

beforeAll(async () => {
  await initDb();
});

const management: Ctx = { actor: { ...ctxWithRoles(["MANAGEMENT"]).actor, user_id: "user_management" } };

function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

describe("e31-tests / e31-overdue / e31-loan — runOnce with frozen asOf", () => {
  it("calls overdue, loan-validity, hold-expiry and snapshot jobs with the injected asOf", async () => {
    const asOf = "2026-09-22";
    const seen: { fn: string; asOf: string; extra?: string }[] = [];
    const deps: SchedulerDeps = {
      overdue: async (day) => {
        seen.push({ fn: "overdue", asOf: day });
        return [{ demand_id: "d1", action_id: "a1" }];
      },
      loans: async (day) => {
        seen.push({ fn: "loans", asOf: day });
        return [{ loan_id: "l1" }, { loan_id: "l2" }];
      },
      holds: async (day) => {
        seen.push({ fn: "holds", asOf: day });
        return { expired: ["h_tanvi"] };
      },
      snapshot: async (projectId, _kind, ctx, day) => {
        expect(ctx).toBeUndefined();
        seen.push({ fn: "snapshot", asOf: day, extra: projectId });
        return { id: `snap_${projectId}` };
      },
      projectIds: async () => ["p_eastcrest", "p_meadows"],
    };

    const result = await runOnce(asOf, deps);
    expect(seen.filter((s) => s.fn === "overdue")).toHaveLength(1);
    expect(seen.filter((s) => s.fn === "loans")).toHaveLength(1);
    expect(seen.filter((s) => s.fn === "holds")).toHaveLength(1);
    expect(seen.filter((s) => s.fn === "snapshot")).toHaveLength(2);
    expect(seen.every((s) => s.asOf === asOf)).toBe(true);
    expect(result).toEqual({
      overdue: 1,
      loans: 2,
      holds: ["h_tanvi"],
      snapshots: ["snap_p_eastcrest", "snap_p_meadows"],
    });
  });

  it("swallows a per-project snapshot error and still finishes", async () => {
    const result = await runOnce("2026-09-22", {
      overdue: async () => [],
      loans: async () => [],
      holds: async () => ({ expired: [] }),
      snapshot: async (projectId) => {
        if (projectId === "p_bad") throw new Error("derive failed");
        return { id: "snap_ok" };
      },
      projectIds: async () => ["p_bad", "p_ok"],
    });
    expect(result.snapshots).toEqual(["snap_ok"]);
  });
});

describe("e31-hold — Tanvi's Phase 2 hold expires via the job", () => {
  it("runOnce(asOf after approved_until) marks the V101 kitchen_layout hold EXPIRED", async () => {
    const hold = await db.query<{ id: string; approved_until: string; status: string }>(
      `SELECT id, approved_until::text AS approved_until, status
         FROM change_window_hold
        WHERE unit_id = 'u_v101' AND category_code = 'kitchen_layout'
        ORDER BY created_at DESC LIMIT 1`
    );
    expect(hold.rows[0], "Tanvi / u_v101 kitchen_layout hold").toBeTruthy();
    expect(hold.rows[0]!.status).toBe("APPROVED");
    const until = hold.rows[0]!.approved_until.slice(0, 10);
    const asOf = addDays(until, 1);

    const result = await runOnce(asOf);
    expect(result.holds).toContain(hold.rows[0]!.id);

    const after = await db.query<{ status: string }>(`SELECT status FROM change_window_hold WHERE id = $1`, [hold.rows[0]!.id]);
    expect(after.rows[0]!.status).toBe("EXPIRED");
  });
});

describe("e31-forecast — snapshot is a scheduled write, not GET", () => {
  it("getForecast twice does not insert a snapshot; runOnce does", async () => {
    const count = async () =>
      Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM forecast_snapshot`)).rows[0]!.n);

    const before = await count();
    await getForecast("p_eastcrest", {}, management);
    await getForecast("p_eastcrest", {}, management);
    expect(await count()).toBe(before);

    const result = await runOnce("2026-09-15");
    expect(result.snapshots.length).toBeGreaterThan(0);
    expect(await count()).toBe(before + result.snapshots.length);
  });
});
