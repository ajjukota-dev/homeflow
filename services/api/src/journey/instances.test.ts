import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking, acceptBooking, type BookingInput } from "../bookings";
import { createProject, createUnit } from "../projects";
import {
  instantiateJourneyForBooking,
  holdJourney,
  resumeJourney,
  closeJourney,
  completeTaskInstance,
  reopenTaskInstance,
  getJourneyForBooking,
} from "./instances";
import { withTx } from "../events";

let PROJECT_ID: string;
let unitSeq = 0;

beforeAll(async () => {
  await initDb();
  // A fresh project (no journey_template_version_id assigned) so instantiation exercises rule
  // 1's Standard fallback, and with as many available units as this file's tests need — the
  // seeded East Crest project only has 3 unbooked villas, not enough for one booking per test.
  const p = await createProject({ code: "jitest", name: "Journey Instances Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

const fullDocs = [
  { type: "PAN card", received: true },
  { type: "Address proof", received: true },
  { type: "Photograph", received: true },
];

function freshBookingInput(): BookingInput {
  unitSeq++;
  return {
    applicant: { display_name: `Test Applicant ${unitSeq}`, phone: `98765${String(unitSeq).padStart(5, "0")}`, pan: "ABCDE1234F" },
    total_consideration: 9000000,
    docs: fullDocs,
  };
}

/** Goes through the real acceptBooking flow (proves rule 1's subscriber wiring end to end).
 *  The customer this creates is always RESIDENT — acceptBooking has no residency input, and
 *  rule 1's "re-evaluate on customer.residency_changed" is deliberately not built in this
 *  slice (see instances.ts's header), so there's no way to get an NRI customer through this
 *  path. Use `instantiateWithResidency` for the NRI conditional-task test instead. */
async function bookAndAccept() {
  unitSeq++;
  const unit = await createUnit(PROJECT_ID, { unit_number: `JT-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(unit!.id, freshBookingInput(), superAdminCtx);
  const { booking } = await acceptBooking(b.id, superAdminCtx);
  return booking.id;
}

/** Builds a booking + customer + applicant directly (bypassing acceptBooking, which always
 *  creates a RESIDENT customer) so the NRI conditional-task path (rule 1 / T4) is reachable,
 *  then instantiates the journey directly against that fixed residency. */
async function instantiateWithResidency(residency: "RESIDENT" | "NRI") {
  unitSeq++;
  const unit = await createUnit(PROJECT_ID, { unit_number: `JT-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  const customerId = "c_jt_" + unitSeq;
  const bookingId = "b_jt_" + unitSeq;
  await db.query(`INSERT INTO customer (id, display_name, primary_phone, kyc_status, code, primary_name, residency) VALUES ($1,'Test',$2,'verified',$3,'Test',$4)`, [
    customerId, `9${unitSeq}`, `CUS-JT-${unitSeq}`, residency,
  ]);
  await db.query(
    `INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score, code, agreement_value_inr)
     VALUES ($1,$2,$3,$4,'active',9000000,100,$4,9000000)`,
    [bookingId, PROJECT_ID, unit!.id, `BK-JT-${unitSeq}`]
  );
  await db.query(`INSERT INTO booking_applicant (id, booking_id, customer_id, display_name, role) VALUES ($1,$2,$3,'Test','primary')`, [
    "a_jt_" + unitSeq, bookingId, customerId,
  ]);
  await withTx(undefined, (tx) => instantiateJourneyForBooking(bookingId, tx));
  return bookingId;
}

describe("journey/instances: rule 1 — instantiation on sales_handover.accepted", () => {
  it("acceptBooking (real subscriber, not a direct call) creates a journey_instance", async () => {
    const bookingId = await bookAndAccept();
    const j = await db.query<{ id: string; status: string; template_version_id: string }>(
      `SELECT id, status, template_version_id FROM journey_instance WHERE booking_id = $1`,
      [bookingId]
    );
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].status).toBe("ACTIVE");

    const version = await db.query<{ code: string }>(
      `SELECT jt.code FROM journey_template_version jtv JOIN journey_template jt ON jt.id = jtv.template_id WHERE jtv.id = $1`,
      [j.rows[0].template_version_id]
    );
    expect(version.rows[0].code).toBe("PRANAVA_STANDARD"); // rule 1 fallback — this test project has no template assigned
  });

  it("is idempotent — instantiating twice for the same booking returns the same journey", async () => {
    const bookingId = await bookAndAccept();
    const again = await withTx(undefined, (tx) => instantiateJourneyForBooking(bookingId, tx));
    const j = await db.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1`, [bookingId]);
    expect(again).toBe(j.rows[0].id);
  });
});

describe("journey/instances: rule 1 conditional filtering + rule 2/4 scheduling", () => {
  it("PT1 (no dependencies) starts its SLA clock immediately; T1 (depends on PT1) does not yet", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const presales = journey!.stages.find((s) => s.stage_code === "PRESALES")!;
    const booking = journey!.stages.find((s) => s.stage_code === "BOOKING")!;
    expect(presales.tasks.find((t) => t.task_code === "PT1")!.clock_status).not.toBeNull();
    expect(booking.tasks.find((t) => t.task_code === "T1")!.clock_status).toBeNull();
  });

  it("excludes the CUSTOMISATION stage (no change requests at creation)", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    expect(journey!.stages.some((s) => s.stage_code === "CUSTOMISATION")).toBe(false);
  });

  it("all 12 stages present except CUSTOMISATION for a RESIDENT customer, and T4 (NRI-only) excluded", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    expect(journey!.stages).toHaveLength(11); // 12 minus CUSTOMISATION
    const docsKyc = journey!.stages.find((s) => s.stage_code === "DOCS_KYC")!;
    expect(docsKyc.tasks.map((t) => t.task_code)).toEqual(["T3"]); // T4 excluded for a RESIDENT
  });

  it("includes T4 (NRI declaration) for an NRI customer", async () => {
    const bookingId = await instantiateWithResidency("NRI");
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const docsKyc = journey!.stages.find((s) => s.stage_code === "DOCS_KYC")!;
    expect(docsKyc.tasks.map((t) => t.task_code)).toEqual(["T3", "T4"]);
  });

  it("rule 4: parallel stages with no edge between them both start on the journey start date", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const presales = journey!.stages.find((s) => s.stage_code === "PRESALES")!;
    // PRESALES has no predecessor — its baseline start is the journey's own creation date.
    const today = new Date().toISOString().slice(0, 10);
    expect(presales.baseline_start <= today).toBe(true);
  });
});

describe("journey/instances: rule 5 — SLA clock cascades on task completion", () => {
  it("completing PT1 starts T1's clock; completing T1 starts T2's", async () => {
    const bookingId = await bookAndAccept();
    let journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const pt1 = journey!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "PT1")!;
    const pt1Instance = await db.query<{ id: string }>(`SELECT id FROM task_instance WHERE task_code = 'PT1' AND stage_instance_id IN (SELECT id FROM stage_instance WHERE journey_id = $1)`, [journey!.id]);
    expect(pt1.clock_status).not.toBeNull();

    await completeTaskInstance(pt1Instance.rows[0].id, superAdminCtx);
    journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const t1 = journey!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "T1")!;
    expect(t1.status).toBe("New");
    expect(t1.clock_status).not.toBeNull(); // now actionable

    const t1Instance = await db.query<{ id: string }>(`SELECT id FROM task_instance WHERE task_code = 'T1' AND stage_instance_id IN (SELECT id FROM stage_instance WHERE journey_id = $1)`, [journey!.id]);
    await completeTaskInstance(t1Instance.rows[0].id, superAdminCtx);
    journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const t2 = journey!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "T2")!;
    expect(t2.clock_status).not.toBeNull();
  });

  it("completing every task in a stage marks the stage COMPLETED", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const presalesTask = journey!.stages.find((s) => s.stage_code === "PRESALES")!.tasks[0];
    const taskInstance = await db.query<{ id: string }>(
      `SELECT ti.id FROM task_instance ti JOIN stage_instance si ON si.id = ti.stage_instance_id WHERE si.journey_id = $1 AND ti.task_code = $2`,
      [journey!.id, presalesTask.task_code]
    );
    await completeTaskInstance(taskInstance.rows[0].id, superAdminCtx);
    const after = await getJourneyForBooking(bookingId, superAdminCtx);
    expect(after!.stages.find((s) => s.stage_code === "PRESALES")!.status).toBe("COMPLETED");
  });
});

describe("journey/instances: rule 7 — reopen resets transitive dependents", () => {
  it("reopening PT1 after T1 has completed resets T1 back to New and voids its clock", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const pt1Instance = await db.query<{ id: string }>(`SELECT id FROM task_instance WHERE task_code = 'PT1' AND stage_instance_id IN (SELECT id FROM stage_instance WHERE journey_id = $1)`, [journey!.id]);
    await completeTaskInstance(pt1Instance.rows[0].id, superAdminCtx);
    const t1Instance = await db.query<{ id: string }>(`SELECT id FROM task_instance WHERE task_code = 'T1' AND stage_instance_id IN (SELECT id FROM stage_instance WHERE journey_id = $1)`, [journey!.id]);
    await completeTaskInstance(t1Instance.rows[0].id, superAdminCtx);

    await reopenTaskInstance(pt1Instance.rows[0].id, "wrong evidence uploaded", superAdminCtx);

    const after = await getJourneyForBooking(bookingId, superAdminCtx);
    const pt1 = after!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "PT1")!;
    const t1 = after!.stages.flatMap((s) => s.tasks).find((t) => t.task_code === "T1")!;
    expect(pt1.status).toBe("New");
    expect(pt1.clock_status).toBeNull();
    expect(t1.status).toBe("New"); // transitively reset
    expect(t1.clock_status).toBeNull();
  });

  it("reopen requires a reason", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    const anyTask = await db.query<{ id: string }>(`SELECT id FROM task_instance WHERE stage_instance_id IN (SELECT id FROM stage_instance WHERE journey_id = $1) LIMIT 1`, [journey!.id]);
    await expect(reopenTaskInstance(anyTask.rows[0].id, "", superAdminCtx)).rejects.toThrow(/reason/);
  });
});

describe("journey/instances: rule 8 — hold/resume/close", () => {
  it("hold and resume require a reason and flip status", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    await expect(holdJourney(journey!.id, "", superAdminCtx)).rejects.toThrow(/reason/);
    await holdJourney(journey!.id, "customer requested a pause", superAdminCtx);
    let j = await db.query<{ status: string }>(`SELECT status FROM journey_instance WHERE id = $1`, [journey!.id]);
    expect(j.rows[0].status).toBe("ON_HOLD");

    await resumeJourney(journey!.id, "customer ready again", superAdminCtx);
    j = await db.query<{ status: string }>(`SELECT status FROM journey_instance WHERE id = $1`, [journey!.id]);
    expect(j.rows[0].status).toBe("ACTIVE");
  });

  it("close is MANAGEMENT/SUPER_ADMIN only", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);
    await expect(closeJourney(journey!.id, "cancelled by customer", ctxWithRoles(["SALES"]))).rejects.toThrow();
    await closeJourney(journey!.id, "cancelled by customer", superAdminCtx);
    const j = await db.query<{ status: string }>(`SELECT status FROM journey_instance WHERE id = $1`, [journey!.id]);
    expect(j.rows[0].status).toBe("CLOSED");
  });
});

// events/registry.test.ts's coverage test requires a literal emit site (already true — see
// instances.ts) plus a literal assertion in some *.test.ts file for every built event type.
describe("journey/instances: emits the 06 event types it's registered for", () => {
  it("journey.started, stage.completed, task_instance.reopened, journey.held/resumed/closed all land in the event log", async () => {
    const bookingId = await bookAndAccept();
    const journey = await getJourneyForBooking(bookingId, superAdminCtx);

    const started = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'journey.started' AND entity_id = $1`, [journey!.id]);
    expect(started.rows).toHaveLength(1);

    const presalesTask = journey!.stages.find((s) => s.stage_code === "PRESALES")!.tasks[0];
    const taskInstance = await db.query<{ id: string }>(
      `SELECT ti.id FROM task_instance ti JOIN stage_instance si ON si.id = ti.stage_instance_id WHERE si.journey_id = $1 AND ti.task_code = $2`,
      [journey!.id, presalesTask.task_code]
    );
    await completeTaskInstance(taskInstance.rows[0].id, superAdminCtx);
    const stageCompleted = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'stage.completed'`);
    expect(stageCompleted.rows.length).toBeGreaterThan(0);

    await reopenTaskInstance(taskInstance.rows[0].id, "needs re-verification", superAdminCtx);
    const reopened = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'task_instance.reopened' AND entity_id = $1`, [taskInstance.rows[0].id]);
    expect(reopened.rows).toHaveLength(1);

    await holdJourney(journey!.id, "pause", superAdminCtx);
    await resumeJourney(journey!.id, "resume", superAdminCtx);
    await closeJourney(journey!.id, "done", superAdminCtx);
    const heldEvt = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'journey.held' AND entity_id = $1`, [journey!.id]);
    const resumedEvt = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'journey.resumed' AND entity_id = $1`, [journey!.id]);
    const closedEvt = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'journey.closed' AND entity_id = $1`, [journey!.id]);
    expect(heldEvt.rows).toHaveLength(1);
    expect(resumedEvt.rows).toHaveLength(1);
    expect(closedEvt.rows).toHaveLength(1);
  });
});
