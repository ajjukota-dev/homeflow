import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking, acceptBooking, type BookingInput } from "../bookings";
import { createProject, createUnit } from "../projects";
import { getJourneyForBooking } from "./instances";
import { createPlanRevision, listPlanRevisions } from "./plan-revision";
import { asDateStr } from "./calendar";
import type { Ctx } from "../authz/types";

// 06-timeline-sla-engine.md rule 2/8, t8 ("Delay reason is mandatory when a planned date moves").
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
const managementCtx: Ctx = { actor: { ...ctxWithRoles(["MANAGEMENT"]).actor, user_id: "user_pr_mgmt" } };
const salesCtx = ctxWithRoles(["SALES"]);

let PROJECT_ID: string;
let unitSeq = 0;

function freshBookingInput(): BookingInput {
  unitSeq++;
  return {
    applicant: { display_name: `PR Applicant ${unitSeq}`, phone: `97000${String(unitSeq).padStart(5, "0")}`, pan: "ABCDE1234F" },
    total_consideration: 9000000,
    docs: [{ type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true }],
  };
}

async function freshJourney(): Promise<string> {
  unitSeq++;
  const unit = await createUnit(PROJECT_ID, { unit_number: `PR-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(unit!.id, freshBookingInput(), superAdminCtx);
  const { booking } = await acceptBooking(b.id, superAdminCtx);
  const j = await db.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1`, [booking.id]);
  return j.rows[0].id;
}

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "prtest", name: "Plan Revision Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
  await db.query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ('user_pr_mgmt','pr@test.local','PR Mgmt','ACTIVE','STAFF') ON CONFLICT (id) DO NOTHING`);
});

describe("createPlanRevision", () => {
  it("refuses SALES; MANAGEMENT and SUPER_ADMIN can revise", async () => {
    const journeyId = await freshJourney();
    const input = { changes: [{ stage_code: "PRESALES", new_planned_start: "2026-01-01", new_planned_end: "2026-01-06" }], reason_code: "CUSTOMER_DELAY_TEST" };
    await db.query(`INSERT INTO delay_reason (code, label, category) VALUES ('CUSTOMER_DELAY_TEST','Customer delay (test)','CUSTOMER') ON CONFLICT (code) DO NOTHING`);
    await expect(createPlanRevision(journeyId, input, salesCtx)).rejects.toThrow(/requires one of/);
    const rev = await createPlanRevision(journeyId, input, managementCtx);
    expect(rev.changes).toHaveLength(1);
  });

  it("rejects an empty changes list, an unknown reason_code, an unknown stage_code, and end-before-start", async () => {
    const journeyId = await freshJourney();
    await expect(createPlanRevision(journeyId, { changes: [], reason_code: "CUSTOMER_DELAY_TEST" }, superAdminCtx)).rejects.toThrow(/at least one/);
    await expect(
      createPlanRevision(journeyId, { changes: [{ stage_code: "PRESALES", new_planned_start: "2026-01-01", new_planned_end: "2026-01-06" }], reason_code: "NOPE" }, superAdminCtx)
    ).rejects.toThrow(/unknown delay reason/);
    await expect(
      createPlanRevision(journeyId, { changes: [{ stage_code: "NOT_A_STAGE", new_planned_start: "2026-01-01", new_planned_end: "2026-01-06" }], reason_code: "CUSTOMER_DELAY_TEST" }, superAdminCtx)
    ).rejects.toThrow(/no stage/);
    await expect(
      createPlanRevision(journeyId, { changes: [{ stage_code: "PRESALES", new_planned_start: "2026-01-10", new_planned_end: "2026-01-01" }], reason_code: "CUSTOMER_DELAY_TEST" }, superAdminCtx)
    ).rejects.toThrow(/before planned_start/);
  });

  it("moves planned_start/end, leaves baseline untouched, and records the old/new diff", async () => {
    const journeyId = await freshJourney();
    const before = await db.query<{ baseline_start: string | Date; baseline_end: string | Date; planned_start: string | Date; planned_end: string | Date }>(
      `SELECT baseline_start, baseline_end, planned_start, planned_end FROM stage_instance WHERE journey_id = $1 AND stage_code = 'PRESALES'`,
      [journeyId]
    );

    const rev = await createPlanRevision(
      journeyId,
      { changes: [{ stage_code: "PRESALES", new_planned_start: "2026-03-01", new_planned_end: "2026-03-10" }], reason_code: "CUSTOMER_DELAY_TEST", note: "client asked to push" },
      superAdminCtx
    );
    expect(rev.note).toBe("client asked to push");
    expect(rev.changes[0]).toMatchObject({ stage_code: "PRESALES", new_planned_start: "2026-03-01", new_planned_end: "2026-03-10" });

    const after = await db.query<{ baseline_start: string | Date; baseline_end: string | Date; planned_start: string | Date; planned_end: string | Date }>(
      `SELECT baseline_start, baseline_end, planned_start, planned_end FROM stage_instance WHERE journey_id = $1 AND stage_code = 'PRESALES'`,
      [journeyId]
    );
    expect(asDateStr(after.rows[0].baseline_start)).toBe(asDateStr(before.rows[0].baseline_start));
    expect(asDateStr(after.rows[0].baseline_end)).toBe(asDateStr(before.rows[0].baseline_end));
    expect(asDateStr(after.rows[0].planned_start)).toBe("2026-03-01");
    expect(asDateStr(after.rows[0].planned_end)).toBe("2026-03-10");

    const journey = await getJourneyForBooking((await db.query<{ booking_id: string }>(`SELECT booking_id FROM journey_instance WHERE id = $1`, [journeyId])).rows[0].booking_id, superAdminCtx);
    const presales = journey!.stages.find((s) => s.stage_code === "PRESALES")!;
    expect(presales.planned_start).toBe("2026-03-01");
  });

  // 02 §Appendix B / registry.test.ts coverage: plan.revised must have a real emitter test, not
  // just a mention in the registry — this is the one that satisfies it.
  it("emits a plan.revised event", async () => {
    const journeyId = await freshJourney();
    await createPlanRevision(
      journeyId,
      { changes: [{ stage_code: "PRESALES", new_planned_start: "2026-04-01", new_planned_end: "2026-04-06" }], reason_code: "CUSTOMER_DELAY_TEST" },
      superAdminCtx
    );
    const evt = await db.query<{ type: string; entity_id: string }>(
      `SELECT type, entity_id FROM event WHERE type = 'plan.revised' AND entity_id = $1`,
      [journeyId]
    );
    expect(evt.rows).toHaveLength(1);
    expect(evt.rows[0].type).toBe("plan.revised");
  });
});

describe("listPlanRevisions", () => {
  it("returns a journey's revisions newest-first", async () => {
    const journeyId = await freshJourney();
    await createPlanRevision(journeyId, { changes: [{ stage_code: "PRESALES", new_planned_start: "2026-02-01", new_planned_end: "2026-02-05" }], reason_code: "CUSTOMER_DELAY_TEST" }, superAdminCtx);
    await createPlanRevision(journeyId, { changes: [{ stage_code: "PRESALES", new_planned_start: "2026-02-10", new_planned_end: "2026-02-15" }], reason_code: "CUSTOMER_DELAY_TEST" }, superAdminCtx);
    const revisions = await listPlanRevisions(journeyId, superAdminCtx);
    expect(revisions).toHaveLength(2);
    expect(new Date(revisions[0].revised_at).getTime()).toBeGreaterThanOrEqual(new Date(revisions[1].revised_at).getTime());
  });

  it("returns an empty list for a journey with no revisions", async () => {
    const journeyId = await freshJourney();
    expect(await listPlanRevisions(journeyId, superAdminCtx)).toEqual([]);
  });
});
