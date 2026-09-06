import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking, acceptBooking, type BookingInput } from "../bookings";
import { createProject, createUnit } from "../projects";
import { getProjectJourneyControl } from "./control";
import { createPlanRevision } from "./plan-revision";
import type { Ctx } from "../authz/types";

// Project Journey Control (06-timeline-sla-engine.md Screens): "table of journeys with health,
// current stage per stream, forecast handover, slippage ... top delay reasons".
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
const customerCtx = ctxWithRoles(["CUSTOMER"]);

let PROJECT_ID: string;
let unitSeq = 0;

function freshBookingInput(name: string): BookingInput {
  unitSeq++;
  return {
    applicant: { display_name: name, phone: `95000${String(unitSeq).padStart(5, "0")}`, pan: "ABCDE1234F" },
    total_consideration: 9000000,
    docs: [{ type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true }],
  };
}

async function freshJourney(customerName: string): Promise<{ journeyId: string }> {
  unitSeq++;
  const unit = await createUnit(PROJECT_ID, { unit_number: `CTL-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(unit!.id, freshBookingInput(customerName), superAdminCtx);
  const { booking } = await acceptBooking(b.id, superAdminCtx);
  const j = await db.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1`, [booking.id]);
  return { journeyId: j.rows[0].id };
}

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "ctltest", name: "Journey Control Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
  await db.query(`INSERT INTO delay_reason (code, label, category) VALUES ('CUSTOMER_DELAY_TEST','Customer delay (test)','CUSTOMER') ON CONFLICT (code) DO NOTHING`);
});

describe("getProjectJourneyControl", () => {
  it("refuses CUSTOMER; any staff role can read", async () => {
    await expect(getProjectJourneyControl(PROJECT_ID, customerCtx)).rejects.toThrow(/requires one of/);
    const result = await getProjectJourneyControl(PROJECT_ID, superAdminCtx);
    expect(result).toHaveProperty("journeys");
  });

  it("lists a real booking's journey with customer/unit identity and a current COMMERCIAL-stream stage", async () => {
    await freshJourney("Ravi Kumar");
    const result = await getProjectJourneyControl(PROJECT_ID, superAdminCtx);
    const row = result.journeys.find((j) => j.customer_name === "Ravi Kumar")!;
    expect(row).toBeTruthy();
    expect(row.health).toBe("ON_TRACK");
    const commercial = row.current_stage_per_stream.find((s) => s.stream === "COMMERCIAL");
    expect(commercial?.stage_code).toBe("PRESALES"); // earliest open stage on the COMMERCIAL stream at instantiation
  });

  it("a plan revision on one journey doesn't change another journey's row, and shows up as slippage + a top delay reason", async () => {
    const a = await freshJourney("Delayed Customer");
    await freshJourney("Untouched Customer");

    // POST_HANDOVER is PRANAVA_STANDARD's last stage (90-day planned_duration_days, seed/journey-standard.ts)
    // — pushing it out is guaranteed to move planned_handover, unlike an earlier, non-max stage.
    await createPlanRevision(
      a.journeyId,
      { changes: [{ stage_code: "POST_HANDOVER", new_planned_start: "2027-01-01", new_planned_end: "2027-06-10" }], reason_code: "CUSTOMER_DELAY_TEST" },
      superAdminCtx
    );

    const result = await getProjectJourneyControl(PROJECT_ID, superAdminCtx);
    const delayed = result.journeys.find((j) => j.journey_id === a.journeyId)!;
    const untouched = result.journeys.find((j) => j.customer_name === "Untouched Customer")!;
    expect(delayed.planned_handover).toBe("2027-06-10"); // MAX(planned_end) across stages, pushed out by the revision
    expect(untouched.planned_handover).not.toBe("2027-06-10");

    expect(result.top_delay_reasons.some((r) => r.code === "CUSTOMER_DELAY_TEST" && r.count >= 1)).toBe(true);
  });
});
