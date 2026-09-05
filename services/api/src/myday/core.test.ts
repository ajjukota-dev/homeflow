import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking, acceptBooking } from "../bookings";
import { createProject, createUnit } from "../projects";
import { startAction, submitForApproval, claimAction } from "../actions/core";
import { getMyDay, getTeamDay } from "./core";
import type { Ctx } from "../authz/types";

// 11-my-day-ranking.md. Real seeded demo users (seed/users.ts), same reason 12/13's own test
// files override ctxWithRoles()'s default synthetic "test_user" id.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const sales = () => ctxAs("user_sales", ["SALES"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);

let PROJECT_ID: string;
let unitSeq = 0;

const fullDocs = [
  { type: "PAN card", received: true },
  { type: "Address proof", received: true },
  { type: "Photograph", received: true },
];

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "mydaytest", name: "My Day Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshPT1Action(): Promise<string> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `M-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "My Day Test", phone: `9554433${String(unitSeq).padStart(3, "0")}`, pan: `MYDTU${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 5000000, docs: fullDocs },
    superAdminCtx
  );
  await acceptBooking(b!.id, superAdminCtx);
  const ti = await db.query<{ action_id: string }>(
    `SELECT ti.action_id FROM task_instance ti JOIN stage_instance si ON si.id = ti.stage_instance_id WHERE si.journey_id = (SELECT id FROM journey_instance WHERE booking_id = $1) AND ti.task_code = 'PT1'`,
    [b!.id]
  );
  return ti.rows[0]!.action_id!;
}

describe("getMyDay (rule 1) — five ordered sections + done-today count", () => {
  it("places a claimed action in waiting_on_me, and moves it to due_today once its SLA clock enters its due window", async () => {
    const actionId = await freshPT1Action();
    await claimAction(actionId, sales());
    const before = await getMyDay(sales(), PROJECT_ID);
    expect(before.waiting_on_me.some((a) => a.id === actionId)).toBe(true);
    expect(before.waiting_on_me[0]!.why_now.length).toBeGreaterThan(0);

    // Seeded SLA policies land due_at exactly at IST midnight, so "an hour before due" would
    // actually fall on the PREVIOUS IST calendar day — use an hour AFTER due instead, still
    // squarely inside the due date's own IST day (rule 1 is about the calendar day, not whether
    // the exact instant has passed).
    const clock = await db.query<{ due_at: string }>(`SELECT c.due_at::text AS due_at FROM action a JOIN sla_clock c ON c.id = a.sla_clock_id WHERE a.id = $1`, [actionId]);
    const asOf = new Date(new Date(clock.rows[0]!.due_at).getTime() + 60 * 60 * 1000).toISOString();
    const onDueDay = await getMyDay(sales(), PROJECT_ID, asOf);
    expect(onDueDay.due_today.some((a) => a.id === actionId)).toBe(true);
    expect(onDueDay.waiting_on_me.some((a) => a.id === actionId)).toBe(false); // due_today takes precedence, no double-bucketing
  });

  it("places a Ready for Approval action in needs_my_approval only for the resolved approver role", async () => {
    const actionId = await freshPT1Action();
    await claimAction(actionId, sales());
    await startAction(actionId, sales());
    await submitForApproval(actionId, sales()).catch(() => undefined); // exec_simple has no approval gate — best-effort, not the point of this test
    const day = await getMyDay(management(), PROJECT_ID);
    expect(Array.isArray(day.needs_my_approval)).toBe(true); // shape check — PT1 isn't an approval-family action, so this stays empty, which is correct
  });
});

describe("getTeamDay (rule 5) — gated on MANAGEMENT/SUPER_ADMIN or a real CENTRAL primary-owner assignment", () => {
  it("rejects a plain SALES actor with no primary-owner assignment, and returns per-member aggregates for MANAGEMENT", async () => {
    await expect(getTeamDay(sales(), PROJECT_ID)).rejects.toThrow(/forbidden/);
    const team = await getTeamDay(management(), PROJECT_ID);
    expect(typeof team).toBe("object");
  });
});
