import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx } from "../authz/test-helpers";
import { createBooking, acceptBooking, type BookingInput } from "../bookings";
import { createProject, createUnit } from "../projects";
import { getJourneyForBooking, completeTaskInstance } from "./instances";
import { getTaskInstanceDetail } from "./task-detail";
import { startAction, blockAction, getAction, createAction } from "../actions/core";
import { withTx } from "../events";
import type { Ctx } from "../authz/types";

// Wave D bug 3: AT_RISK only from blocked / forecast after plan / dependency overdue.
// A running SLA clock is not "in progress" unless a task or action says so.

const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };

let PROJECT_ID: string;
let unitSeq = 0;

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "atrisk", name: "At Risk Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

function freshBookingInput(): BookingInput {
  unitSeq++;
  return {
    applicant: { display_name: `AtRisk Applicant ${unitSeq}`, phone: `97000${String(unitSeq).padStart(5, "0")}`, pan: "ABCDE1234F" },
    total_consideration: 9000000,
    docs: [
      { type: "PAN card", received: true },
      { type: "Address proof", received: true },
      { type: "Photograph", received: true },
    ],
  };
}

async function bookAndAccept() {
  unitSeq++;
  const unit = await createUnit(PROJECT_ID, { unit_number: `AR-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(unit!.id, freshBookingInput(), superAdminCtx);
  const { booking } = await acceptBooking(b.id, superAdminCtx);
  return booking.id;
}

async function taskRow(bookingId: string, code: string) {
  const journey = await getJourneyForBooking(bookingId, superAdminCtx);
  const task = journey!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === code);
  if (!task) throw new Error(`missing task ${code}`);
  return { journey, task };
}

/** Push the clock far enough that DUE_SOON / OVERDUE cannot mask AT_RISK. */
async function pushDueFar(slaClockId: string): Promise<void> {
  await db.query(`UPDATE sla_clock SET due_at = now() + interval '30 days' WHERE id = $1`, [slaClockId]);
}

describe("journey AT_RISK from real data (wave D bug 3)", () => {
  it("a case with no blocked / forecast-after-plan / overdue dependency is not AT_RISK", async () => {
    const bookingId = await bookAndAccept();
    const { task } = await taskRow(bookingId, "PT1");
    const clock = await db.query<{ id: string }>(`SELECT sla_clock_id AS id FROM task_instance WHERE id = $1`, [task.task_instance_id]);
    await pushDueFar(clock.rows[0].id);
    const after = await getJourneyForBooking(bookingId, superAdminCtx);
    const pt1 = after!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "PT1")!;
    expect(pt1.clock_status).toBe("ON_TRACK");
    expect(pt1.clock_status).not.toBe("AT_RISK");
  });

  it("forecast after plan marks the clock AT_RISK", async () => {
    const bookingId = await bookAndAccept();
    const { task } = await taskRow(bookingId, "PT1");
    const clock = await db.query<{ id: string }>(`SELECT sla_clock_id AS id FROM task_instance WHERE id = $1`, [task.task_instance_id]);
    await pushDueFar(clock.rows[0].id);
    await db.query(
      `UPDATE task_instance SET forecast_end = planned_end + 5 WHERE id = $1`,
      [task.task_instance_id]
    );
    const after = await getJourneyForBooking(bookingId, superAdminCtx);
    const pt1 = after!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "PT1")!;
    expect(pt1.clock_status).toBe("AT_RISK");
    const detail = await getTaskInstanceDetail(task.task_instance_id, superAdminCtx);
    expect(detail.clock!.status).toBe("AT_RISK");
  });

  it("a blocked action marks the clock AT_RISK", async () => {
    const bookingId = await bookAndAccept();
    const { task } = await taskRow(bookingId, "PT1");
    const clock = await db.query<{ id: string }>(`SELECT sla_clock_id AS id FROM task_instance WHERE id = $1`, [task.task_instance_id]);
    await pushDueFar(clock.rows[0].id);
    await startAction(task.action_id!, superAdminCtx);
    await blockAction(task.action_id!, "waiting on a vendor drawing", null, superAdminCtx);
    const after = await getJourneyForBooking(bookingId, superAdminCtx);
    const pt1 = after!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "PT1")!;
    expect(pt1.clock_status).toBe("AT_RISK");
    const action = await getAction(task.action_id!, superAdminCtx);
    expect(action.sla_state).toBe("AT_RISK");
  });

  it("an overdue dependency marks the successor clock AT_RISK", async () => {
    const bookingId = await bookAndAccept();
    const { journey, task: pt1 } = await taskRow(bookingId, "PT1");
    await completeTaskInstance(pt1.task_instance_id, superAdminCtx);
    const afterPt1 = await getJourneyForBooking(bookingId, superAdminCtx);
    const t1 = afterPt1!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "T1")!;
    expect(t1.clock_status).not.toBeNull();
    const t1Clock = await db.query<{ id: string }>(`SELECT sla_clock_id AS id FROM task_instance WHERE id = $1`, [t1.task_instance_id]);
    await pushDueFar(t1Clock.rows[0].id);

    const dep = await withTx(undefined, (tx) =>
      createAction(
        {
          type: "exec_simple",
          title: "Overdue predecessor",
          source_module: "test",
          source_entity_type: "test_entity",
          source_entity_id: `dep_${journey!.id}`,
          owner_role: "CRM",
          origin: "AUTO",
        },
        tx
      )
    );
    const depClockId = "clk_dep_" + journey!.id.slice(-6);
    await db.query(
      `INSERT INTO sla_clock (id, subject_type, subject_id, policy_id, started_at, due_at)
       SELECT $1, 'action', $2, policy_id, now() - interval '10 days', now() - interval '3 days'
         FROM sla_clock WHERE id = $3`,
      [depClockId, dep, t1Clock.rows[0].id]
    );
    await db.query(`UPDATE action SET sla_clock_id = $2, status = 'In Progress' WHERE id = $1`, [dep, depClockId]);
    await db.query(`UPDATE action SET depends_on_action_id = $2 WHERE id = $1`, [t1.action_id, dep]);

    const after = await getJourneyForBooking(bookingId, superAdminCtx);
    const t1After = after!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "T1")!;
    expect(t1After.clock_status).toBe("AT_RISK");
  });

  it("a running clock does not paint in progress unless a task or action is In Progress", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const presales = journey!.stages.find((s) => s.stage_code === "PRESALES")!;
    const pt1 = presales.tasks.find((t) => t.task_code === "PT1")!;
    expect(pt1.status).toBe("New");
    expect(pt1.clock_status).not.toBeNull();
    expect(pt1.clock_status).not.toBe("IN_PROGRESS");
    expect(presales.status).toBe("NOT_STARTED");

    await startAction(pt1.action_id!, superAdminCtx);
    const after = await getJourneyForBooking(bookingId, superAdminCtx);
    const started = after!.stages.find((s) => s.stage_code === "PRESALES")!;
    const startedPt1 = started.tasks.find((t) => t.task_code === "PT1")!;
    expect(startedPt1.status).toBe("In Progress");
    expect(started.status).toBe("IN_PROGRESS");
  });
});
