import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { randomUUID } from "node:crypto";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking, acceptBooking, type BookingInput } from "../bookings";
import { createProject, createUnit } from "../projects";
import { getTaskInstanceDetail } from "./task-detail";
import type { Ctx } from "../authz/types";

// Stage/Task detail (06-timeline-sla-engine.md Screens): "dates, clock with pause history,
// dependencies, evidence link to the Action" — PT1 (no dependency, real seeded action) and T1
// (depends on PT1, PRANAVA_STANDARD's own real dependency) exercise both halves.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
const customerCtx = ctxWithRoles(["CUSTOMER"]);

let PROJECT_ID: string;
let unitSeq = 0;

function freshBookingInput(): BookingInput {
  unitSeq++;
  return {
    applicant: { display_name: `TD Applicant ${unitSeq}`, phone: `96000${String(unitSeq).padStart(5, "0")}`, pan: "ABCDE1234F" },
    total_consideration: 9000000,
    docs: [{ type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true }],
  };
}

async function freshJourneyId(): Promise<string> {
  unitSeq++;
  const unit = await createUnit(PROJECT_ID, { unit_number: `TD-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(unit!.id, freshBookingInput(), superAdminCtx);
  const { booking } = await acceptBooking(b.id, superAdminCtx);
  const j = await db.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1`, [booking.id]);
  return j.rows[0].id;
}

async function taskInstanceId(journeyId: string, code: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `SELECT ti.id FROM task_instance ti JOIN stage_instance si ON si.id = ti.stage_instance_id WHERE si.journey_id = $1 AND ti.task_code = $2`,
    [journeyId, code]
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "tdtest", name: "Task Detail Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

describe("getTaskInstanceDetail", () => {
  it("404s for an unknown task instance", async () => {
    await expect(getTaskInstanceDetail("nope", superAdminCtx)).rejects.toThrow(/not found/);
  });

  it("refuses CUSTOMER; any staff role can read", async () => {
    const journeyId = await freshJourneyId();
    const pt1 = await taskInstanceId(journeyId, "PT1");
    await expect(getTaskInstanceDetail(pt1, customerCtx)).rejects.toThrow(/requires one of/);
    const detail = await getTaskInstanceDetail(pt1, superAdminCtx);
    expect(detail.task_code).toBe("PT1");
  });

  it("PT1 (no dependency) has a real title, a real action_id, and an active clock with no pause history yet", async () => {
    const journeyId = await freshJourneyId();
    const pt1 = await taskInstanceId(journeyId, "PT1");
    const detail = await getTaskInstanceDetail(pt1, superAdminCtx);
    expect(detail.title).toBe("Personalisation discovery call");
    expect(detail.customer_title).toBe("Discovery call");
    expect(detail.action_id).toBeTruthy(); // every task_instance gets a real action row at creation
    expect(detail.depends_on).toEqual([]);
    expect(detail.clock).not.toBeNull();
    expect(detail.clock!.events.map((e) => e.kind)).toEqual(["START"]); // startClock's own audit event; nothing has paused it yet
  });

  it("T1 depends on PT1 (a real seeded journey_dependency) and starts with no clock yet", async () => {
    const journeyId = await freshJourneyId();
    const t1 = await taskInstanceId(journeyId, "T1");
    const detail = await getTaskInstanceDetail(t1, superAdminCtx);
    expect(detail.depends_on).toEqual([{ task_code: "PT1", kind: "FINISH_TO_START", lag_days: 0 }]);
    expect(detail.clock).toBeNull(); // PT1 not yet complete, so T1 isn't actionable
  });

  it("surfaces real sla_clock_event rows as pause history, oldest first", async () => {
    const journeyId = await freshJourneyId();
    const pt1 = await taskInstanceId(journeyId, "PT1");
    const clock = await db.query<{ sla_clock_id: string }>(`SELECT sla_clock_id FROM task_instance WHERE id = $1`, [pt1]);
    const clockId = clock.rows[0].sla_clock_id!;
    await db.query(`INSERT INTO sla_clock_event (id, clock_id, kind, reason) VALUES ($1,$2,'PAUSE','WAITING_CUSTOMER')`, [randomUUID(), clockId]);
    await db.query(`INSERT INTO sla_clock_event (id, clock_id, kind, reason) VALUES ($1,$2,'RESUME',NULL)`, [randomUUID(), clockId]);

    const detail = await getTaskInstanceDetail(pt1, superAdminCtx);
    expect(detail.clock!.events.map((e) => e.kind)).toEqual(["START", "PAUSE", "RESUME"]);
    expect(detail.clock!.events[1].reason).toBe("WAITING_CUSTOMER");
  });
});
