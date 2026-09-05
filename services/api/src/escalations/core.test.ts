import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking, acceptBooking } from "../bookings";
import { createProject, createUnit } from "../projects";
import { completeTaskInstance } from "../journey/instances";
import { startAction } from "../actions/core";
import {
  scanEscalations,
  listEscalations,
  getEscalation,
  acknowledgeEscalation,
  resolveEscalation,
  closeEscalation,
  reopenEscalation,
} from "./core";
import type { Ctx } from "../authz/types";

// 12-escalations-notifications.md. Real journey-task actions (T1-T13/PT1-PT6) are the only
// actions in this codebase that carry a real sla_clock — see core.ts's header for the grep
// evidence — so every escalation test here drives one through a real booking's journey instance,
// same "real handler chain, no fixture-only shortcuts" precedent as journey/instances.test.ts.

const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const crm = () => ctxAs("user_crm", ["CRM"]);
const banking = () => ctxAs("user_banking", ["BANKING"]);
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
  const p = await createProject({ code: "esctest", name: "Escalations Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshBookingWithT1Action(): Promise<{ bookingId: string; actionId: string; dueAt: string }> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `E-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "Esc Test", phone: `9776655${String(unitSeq).padStart(3, "0")}`, pan: `ESCTU${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 5000000, docs: fullDocs },
    superAdminCtx
  );
  await acceptBooking(b!.id, superAdminCtx);

  const ti = await db.query<{ id: string; action_id: string }>(
    `SELECT ti.id, ti.action_id FROM task_instance ti JOIN stage_instance si ON si.id = ti.stage_instance_id WHERE si.journey_id = (SELECT id FROM journey_instance WHERE booking_id = $1) AND ti.task_code = 'PT1'`,
    [b!.id]
  );
  const actionId = ti.rows[0]!.action_id!;
  // PT1's owner_role is SALES but journey/instances.ts never sets owner_user_id at creation
  // (owner_role is the fallback queue, per action's own schema comment) — claim it as a real
  // SALES user so the escalation's tier-0 owner resolution has something real to resolve to.
  await startAction(actionId, sales());
  const clock = await db.query<{ due_at: string }>(
    `SELECT c.due_at::text AS due_at FROM action a JOIN sla_clock c ON c.id = a.sla_clock_id WHERE a.id = $1`,
    [actionId]
  );
  return { bookingId: b!.id, actionId, dueAt: clock.rows[0]!.due_at };
}

describe("scanEscalations — rule 1: SLA-clock-driven tiering via the STANDARD ladder", () => {
  it("raises no escalation while the task is on track", async () => {
    const { actionId, dueAt } = await freshBookingWithT1Action();
    const farBefore = new Date(new Date(dueAt).getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await scanEscalations(farBefore);
    const esc = await db.query(`SELECT id FROM escalation WHERE action_id = $1`, [actionId]);
    expect(esc.rows).toHaveLength(0);
  });

  it("raises an L0 escalation to the owner once the clock enters DUE_SOON, and tiers to L1 after 48h elapsed", async () => {
    const { actionId, dueAt } = await freshBookingWithT1Action();
    const dueSoonAt = new Date(new Date(dueAt).getTime() - 60 * 60 * 1000).toISOString(); // 1h before due, well within the 2-day due-soon window
    const result1 = await scanEscalations(dueSoonAt);
    expect(result1.raised.length).toBeGreaterThan(0);

    const esc = await db.query<{ id: string; tier: string; owner_user_id: string; status: string; decision_pack: Record<string, unknown> }>(
      `SELECT id, tier, owner_user_id, status, decision_pack FROM escalation WHERE action_id = $1`,
      [actionId]
    );
    expect(esc.rows).toHaveLength(1);
    expect(esc.rows[0]!.tier).toBe("L0");
    expect(esc.rows[0]!.owner_user_id).toBe("user_sales"); // L0 targets OWNER — whoever claimed the action via startAction
    const pack = esc.rows[0]!.decision_pack as { blocked_what: string; since: string; impact: unknown; options: unknown[]; recommended: string; owner_history: unknown };
    expect(pack.blocked_what).toBeTruthy();
    expect(pack.since).toBeTruthy();
    expect(Array.isArray(pack.options)).toBe(true);
    expect(pack.recommended).toBeTruthy();

    // Re-running the scan at the same instant is idempotent — no duplicate row, per rule 3.
    const result1b = await scanEscalations(dueSoonAt);
    expect(result1b.raised).toHaveLength(0);
    const stillOne = await db.query(`SELECT id FROM escalation WHERE action_id = $1`, [actionId]);
    expect(stillOne.rows).toHaveLength(1);

    // 49h after the escalation was first raised (dueSoonAt) — L1's after_hours threshold (48).
    // Not asserting result2.updated's exact contents: this file's other test cases each raise
    // their own escalation against the shared test-file DB (vitest module isolation, same "one
    // DB per test file" precedent everywhere else), and their raised_at values can independently
    // cross the same 48h threshold by the time this scan runs — toContain, not toEqual.
    const laterAt = new Date(new Date(dueSoonAt).getTime() + 49 * 60 * 60 * 1000).toISOString();
    const result2 = await scanEscalations(laterAt);
    expect(result2.updated).toContain(esc.rows[0]!.id);
    const tiered = await db.query<{ tier: string }>(`SELECT tier FROM escalation WHERE id = $1`, [esc.rows[0]!.id]);
    expect(tiered.rows[0]!.tier).toBe("L1");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'escalation.tier_changed' AND entity_id = $1`, [esc.rows[0]!.id]);
    expect(evt.rows.length).toBeGreaterThan(0);
  });

  it("auto-resolves the moment the underlying action closes, not waiting for the next sweep (rule 3, via the action.closed subscriber)", async () => {
    const { bookingId, actionId, dueAt } = await freshBookingWithT1Action();
    const dueSoonAt = new Date(new Date(dueAt).getTime() - 60 * 60 * 1000).toISOString();
    await scanEscalations(dueSoonAt);
    const before = await db.query<{ id: string; status: string }>(`SELECT id, status FROM escalation WHERE action_id = $1`, [actionId]);
    expect(before.rows[0]!.status).toBe("OPEN");

    const ti = await db.query<{ id: string }>(`SELECT id FROM task_instance WHERE action_id = $1`, [actionId]);
    await completeTaskInstance(ti.rows[0]!.id, superAdminCtx);

    const after = await db.query<{ status: string; auto_closed: boolean }>(`SELECT status, auto_closed FROM escalation WHERE id = $1`, [before.rows[0]!.id]);
    expect(after.rows[0]!.status).toBe("RESOLVED");
    expect(after.rows[0]!.auto_closed).toBe(true);
    const evt = await db.query(`SELECT type FROM event WHERE type = 'escalation.resolved' AND entity_id = $1`, [before.rows[0]!.id]);
    expect(evt.rows.length).toBeGreaterThan(0);
    void bookingId;
  });
});

describe("rule 4 — materiality gates only what MANAGEMENT sees", () => {
  it("a non-MANAGEMENT viewer sees the escalation regardless of materiality; MANAGEMENT sees it while it clears the threshold, and loses it once it doesn't", async () => {
    const { actionId, dueAt } = await freshBookingWithT1Action();
    const dueSoonAt = new Date(new Date(dueAt).getTime() - 60 * 60 * 1000).toISOString();
    await scanEscalations(dueSoonAt);

    const asCrm = await listEscalations({}, crm());
    expect(asCrm.some((e) => e.action_id === actionId)).toBe(true);

    // A journey-task escalation's impact is {inr_exposure: null, customer_count: 1} (rule 2's
    // header — the impact resolver's collections/loans branches don't apply here), and the
    // seeded MANAGEMENT_ALERT threshold requires customer_count >= 1 OR inr_exposure >= 500000 —
    // customer_count: 1 clears the seeded bar, so MANAGEMENT sees it too.
    const asManagement = await listEscalations({}, management());
    expect(asManagement.some((e) => e.action_id === actionId)).toBe(true);

    // Prove the filter is actually live, not vacuously permissive: drop this one escalation's
    // impact below both thresholds directly in decision_pack, and confirm MANAGEMENT now excludes
    // it while a non-MANAGEMENT viewer (unfiltered) still sees it.
    const esc = await db.query<{ id: string }>(`SELECT id FROM escalation WHERE action_id = $1`, [actionId]);
    await db.query(
      `UPDATE escalation SET decision_pack = jsonb_set(jsonb_set(decision_pack, '{impact,customer_count}', '0'), '{impact,inr_exposure}', '0') WHERE id = $1`,
      [esc.rows[0]!.id]
    );
    const asManagementAfter = await listEscalations({}, management());
    expect(asManagementAfter.some((e) => e.action_id === actionId)).toBe(false);
    const asCrmAfter = await listEscalations({}, crm());
    expect(asCrmAfter.some((e) => e.action_id === actionId)).toBe(true);
  });
});

describe("rule 7 (as the seeded matrix enforces it) — CRM writes; the escalation's own current owner may also act; everyone else read-only", () => {
  it("BANKING can read but not acknowledge (not the owner, matrix READ only); SALES (the owner, matrix READ only) can via the self-guard; CRM (matrix WRITE) can regardless of ownership", async () => {
    const { actionId, dueAt } = await freshBookingWithT1Action();
    const dueSoonAt = new Date(new Date(dueAt).getTime() - 60 * 60 * 1000).toISOString();
    await scanEscalations(dueSoonAt);
    const esc = await db.query<{ id: string; owner_user_id: string }>(`SELECT id, owner_user_id FROM escalation WHERE action_id = $1`, [actionId]);
    const id = esc.rows[0]!.id;
    expect(esc.rows[0]!.owner_user_id).toBe("user_sales");

    await expect(getEscalation(id, banking())).resolves.toBeTruthy(); // matrix READ
    await expect(acknowledgeEscalation(id, banking())).rejects.toThrow(); // matrix READ only, and not the current owner

    const ackedBySelfGuard = await acknowledgeEscalation(id, sales()); // matrix READ only, but IS the current owner
    expect(ackedBySelfGuard.status).toBe("ACKNOWLEDGED");

    const startedByCrm = await ((): ReturnType<typeof resolveEscalation> => resolveEscalation(id, "CRM took it over", crm()))(); // matrix WRITE, not the owner — still allowed
    expect(startedByCrm.status).toBe("RESOLVED");
  });

  it("resolve requires resolution_notes; the full acknowledge -> resolve -> close -> reopen lifecycle works; an invalid transition is rejected", async () => {
    const { actionId, dueAt } = await freshBookingWithT1Action();
    const dueSoonAt = new Date(new Date(dueAt).getTime() - 60 * 60 * 1000).toISOString();
    await scanEscalations(dueSoonAt);
    const esc = await db.query<{ id: string }>(`SELECT id FROM escalation WHERE action_id = $1`, [actionId]);
    const id = esc.rows[0]!.id;

    const acked = await acknowledgeEscalation(id, crm());
    expect(acked.status).toBe("ACKNOWLEDGED");
    await expect(resolveEscalation(id, "", crm())).rejects.toThrow(/resolution_notes/);
    const resolved = await resolveEscalation(id, "Task completed on follow-up", crm());
    expect(resolved.status).toBe("RESOLVED");
    const closed = await closeEscalation(id, crm());
    expect(closed.status).toBe("CLOSED");
    const closedEvt = await db.query(`SELECT type FROM event WHERE type = 'escalation.closed' AND entity_id = $1`, [id]);
    expect(closedEvt.rows).toHaveLength(1);
    await expect(acknowledgeEscalation(id, crm())).rejects.toThrow(/cannot move escalation/); // CLOSED only accepts REOPENED
    const reopened = await reopenEscalation(id, crm());
    expect(reopened.status).toBe("REOPENED");
  });
});
