import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx } from "../authz/test-helpers";
import { createBooking, acceptBooking } from "../bookings";
import { createProject, createUnit } from "../projects";
import { computeUnitReadiness, explainUnitReadiness } from "./unit-readiness";
import { computeBookingReadiness } from "./booking-readiness";
import { computeHandoverReadiness } from "./handover-readiness";

let PROJECT_ID: string;
let unitSeq = 0;

const fullDocs = [
  { type: "PAN card", received: true },
  { type: "Address proof", received: true },
  { type: "Photograph", received: true },
];

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "scoretest", name: "Scores Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshBooking(): Promise<{ bookingId: string; unitId: string }> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `S-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "Score Test", phone: `9665544${String(unitSeq).padStart(3, "0")}`, pan: `SCRTU${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 5000000, docs: fullDocs },
    superAdminCtx
  );
  await acceptBooking(b!.id, superAdminCtx);
  return { bookingId: b!.id, unitId: unit!.id };
}

describe("unit readiness (rule 1) — the score contract shape, and the acceptance regression", () => {
  it("scores lower with one component COMPLETE-but-not-verified than with every component VERIFIED", async () => {
    const { unitId } = await freshBooking();
    // `insertUnit` (model/units.ts) already scaffolds one qa_evidence row per component_definition
    // at creation time (all unverified) — verify them in place rather than inserting fresh rows.
    await db.query(`UPDATE qa_evidence SET qa_verified = true WHERE unit_id = $1`, [unitId]);
    const fullyVerified = await computeUnitReadiness(unitId);
    expect(fullyVerified.value).toBe(100);
    expect(fullyVerified.confidence).toBe("MEDIUM"); // binary QA-verified model, not rule 1's full state machine (07 unbuilt)

    await db.query(`UPDATE qa_evidence SET qa_verified = false WHERE unit_id = $1 AND component_code = 'flooring'`, [unitId]);
    const oneUnverified = await computeUnitReadiness(unitId);
    expect(oneUnverified.value).toBeLessThan(fullyVerified.value);
    expect(oneUnverified.drivers[0]!.label).toMatch(/not yet QA-verified/);
    expect(oneUnverified.actions.length).toBeGreaterThan(0);

    const explained = await explainUnitReadiness(unitId);
    expect(explained.drivers.length).toBeGreaterThanOrEqual(oneUnverified.drivers.length); // rule 5: full table, not just top 3
  });
});

describe("booking readiness (rule 2)", () => {
  it("returns the Score contract shape and flags the unbuilt documents component rather than guessing it", async () => {
    const { bookingId } = await freshBooking();
    const score = await computeBookingReadiness(bookingId);
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
    expect(score.drivers.length).toBeLessThanOrEqual(3);
    expect(score.confidence_reason).toMatch(/documents/);

    // Completing registration is a real, observable improvement — the score should reflect it.
    await db.query(`INSERT INTO registration_case (id, booking_id, project_id, status, completed_at) VALUES ($1,$2,$3,'completed', now())`, ["reg_" + bookingId, bookingId, PROJECT_ID]);
    const improved = await computeBookingReadiness(bookingId);
    expect(improved.value).toBeGreaterThan(score.value);
  });
});

describe("handover readiness (rule 3) — min-gated composite, commitment penalty", () => {
  it("caps at 69 with the open hard gate as driver #1 when financial clearance hasn't been met", async () => {
    const { bookingId } = await freshBooking();
    const score = await computeHandoverReadiness(bookingId);
    expect(score.value).toBeLessThanOrEqual(69);
    expect(score.confidence).toBe("HIGH"); // capped by a real, deterministic hard gate
    expect(score.drivers[0]!.fact).toBeTruthy();
  });
});
