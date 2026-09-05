import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking } from "../bookings";
import { createProject, createUnit } from "../projects";
import { claimAction, startAction, submitForApproval, approveAction } from "../actions/core";
import { createApprovalRule } from "../approvals/matrix";
import type { Ctx } from "../authz/types";
import { submitHandover, acceptHandover, returnHandover, getSalesHandover, getHandoverMetrics } from "./core";

// 17-sales-crm-handover.md. Real seeded demo users (seed/users.ts), same pattern 12/13/11's own
// test files use to override ctxWithRoles()'s synthetic "test_user" id.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const sales = () => ctxAs("user_sales", ["SALES"]);
const crm = () => ctxAs("user_crm", ["CRM"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);

let PROJECT_ID: string;
let unitSeq = 0;

const FULL_DOCS = [
  // bookings.ts's MANDATORY_DOCS (createBooking's own gate) casing:
  { type: "PAN card", received: true },
  { type: "Address proof", received: true },
  { type: "Photograph", received: true },
  // 17's checklist item_codes (seed/handover-checklist.ts) casing — a deliberately different,
  // coexisting vocabulary (see sales-handover/core.ts header):
  { type: "Booking Form", received: true },
  { type: "Cost Sheet", received: true },
  { type: "PAN", received: true },
  { type: "Identity Proof", received: true },
  { type: "Address Proof", received: true },
];

const FULL_CONFIRMATIONS = {
  applicant_details_confirmed: true,
  contact_verified: true,
  nri_status_confirmed: true,
  communication_pref_confirmed: true,
  unit_confirmed: true,
  facing_confirmed: true,
  parking_confirmed: true,
};

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "handovertest", name: "Handover Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
  // seed/users.ts only assigns the demo CRM user to p_eastcrest — assign them here too so
  // assignRmOwner (rule 5's round robin) has a real candidate for this test project.
  await db.query(
    `INSERT INTO project_team_assignment (id, project_id, user_id, department, role_scope, assignment_type, is_primary_owner, effective_from)
     VALUES ('pta_handovertest_crm', $1, 'user_crm', 'CRM', 'CRM', 'DEDICATED', true, '2020-01-01')`,
    [PROJECT_ID]
  );
});

async function freshBooking(): Promise<string> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `H-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "Handover Test", phone: `9665500${String(unitSeq).padStart(3, "0")}`, pan: `HNDTU${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 5000000, docs: FULL_DOCS },
    sales()
  );
  return b!.id;
}

describe("submitHandover (rules 1, 2, 4)", () => {
  it("blocks submit with a missing-item list when the checklist isn't satisfied, then submits once complete", async () => {
    const bookingId = await freshBooking();
    await expect(submitHandover(bookingId, { commercial: { payment_plan_ref: "PP-1" } }, sales())).rejects.toMatchObject({
      blockers: expect.arrayContaining(["applicant_details_confirmed"]),
    });
    const blocked = await getSalesHandover(bookingId);
    expect(blocked!.status).toBe("DRAFT");

    const submitted = await submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } }, sales());
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.completeness_score).toBe(100);
    expect(submitted.version).toBe(1);

    const review = await db.query<{ id: string }>(`SELECT id FROM action WHERE booking_id = $1 AND title LIKE 'Review handover%'`, [bookingId]);
    expect(review.rows.length).toBe(1);
  });

  it("creates the packet's commitments as DRAFT with source SALES_HANDOVER (13 rule 6)", async () => {
    const bookingId = await freshBooking();
    await submitHandover(
      bookingId,
      {
        confirmations: FULL_CONFIRMATIONS,
        commercial: { payment_plan_ref: "PP-1" },
        commitments: [{ category: "SERVICE", description: "Free modular kitchen upgrade", due_date: "2026-12-01", beneficiary: "CUSTOMER", customer_facing: true }],
      },
      sales()
    );
    const rows = await db.query<{ status: string; source: string }>(`SELECT status, source FROM commitment WHERE booking_id = $1`, [bookingId]);
    expect(rows.rows).toEqual([{ status: "DRAFT", source: "SALES_HANDOVER" }]);
  });
});

describe("commercial approval gate (rule 3)", () => {
  it("blocks submit with an unresolved discount band until the linked approval action is closed", async () => {
    await createApprovalRule({ domain: "DISCOUNT", metric: "INR", min: 1, max: null, approver_role: "MANAGEMENT", effective_from: "2020-01-01" }, superAdminCtx);
    const bookingId = await freshBooking();

    await expect(
      submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { discount_inr: 50000, payment_plan_ref: "PP-1" } }, sales())
    ).rejects.toMatchObject({ blockers: ["commercial_approval:DISCOUNT"] });

    const action = await db.query<{ id: string }>(`SELECT id FROM action WHERE booking_id = $1 AND title = 'Commercial approval: DISCOUNT'`, [bookingId]);
    expect(action.rows.length).toBe(1);
    const actionId = action.rows[0]!.id;
    await claimAction(actionId, management());
    await startAction(actionId, management());
    await submitForApproval(actionId, management());
    await approveAction(actionId, undefined, superAdminCtx);

    const submitted = await submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { discount_inr: 50000, payment_plan_ref: "PP-1" } }, sales());
    expect(submitted.status).toBe("SUBMITTED");
  });
});

describe("acceptHandover (rule 5)", () => {
  it("rejects the submitter's own accept, then assigns rm_owner, creates onboarding actions, activates commitments, and sets first_time_right", async () => {
    const bookingId = await freshBooking();
    await submitHandover(
      bookingId,
      {
        confirmations: FULL_CONFIRMATIONS,
        commercial: { payment_plan_ref: "PP-1" },
        commitments: [{ category: "SERVICE", description: "Extra parking slot", due_date: "2026-11-01", beneficiary: "CUSTOMER", customer_facing: false }],
      },
      sales()
    );
    await expect(acceptHandover(bookingId, sales())).rejects.toThrow(/cannot accept their own/);

    const accepted = await acceptHandover(bookingId, crm());
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.first_time_right).toBe(true);

    const booking = await db.query<{ status: string; rm_owner_user_id: string | null }>(`SELECT status, rm_owner_user_id FROM booking WHERE id = $1`, [bookingId]);
    expect(booking.rows[0]!.status).toBe("active");
    expect(booking.rows[0]!.rm_owner_user_id).toBe("user_crm");

    const onboarding = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM action WHERE booking_id = $1 AND source_module = 'sales_handover' AND title <> 'Review handover ' || (SELECT booking_number FROM booking WHERE id = $1)`,
      [bookingId]
    );
    expect(Number(onboarding.rows[0]!.count)).toBeGreaterThanOrEqual(4);

    const commitment = await db.query<{ status: string }>(`SELECT status FROM commitment WHERE booking_id = $1`, [bookingId]);
    expect(commitment.rows[0]!.status).toBe("ACTIVE");

    const journey = await db.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1`, [bookingId]);
    expect(journey.rows.length).toBe(1);
  });
});

describe("returnHandover (rule 6) + FTR metric (rule 7)", () => {
  it("returns with a taxonomy reason, blocks the submitter's own return, refuses return-after-accept, and lowers first_time_right on resubmit-accept", async () => {
    const bookingId = await freshBooking();
    await submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } }, sales());
    await expect(returnHandover(bookingId, "MISSING_DOCUMENTS", "", sales())).rejects.toThrow(/cannot return their own/);

    const returned = await returnHandover(bookingId, "MISSING_DOCUMENTS", "Cost sheet unsigned", crm());
    expect(returned.status).toBe("RETURNED");
    const booking = await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = $1`, [bookingId]);
    expect(booking.rows[0]!.status).toBe("returned");

    const resubmitted = await submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } }, sales());
    expect(resubmitted.version).toBe(2);
    const accepted = await acceptHandover(bookingId, crm());
    expect(accepted.first_time_right).toBe(false); // version 2 — not first-time-right

    await expect(returnHandover(bookingId, "OTHER", "", crm())).rejects.toThrow(/cannot return a handover from ACCEPTED/);

    const from = "2020-01-01T00:00:00.000Z";
    const to = "2030-01-01T00:00:00.000Z";
    const metrics = await getHandoverMetrics(PROJECT_ID, from, to, crm());
    expect(metrics.accepted).toBeGreaterThan(0);
    expect(metrics.return_reasons.some((r) => r.code === "MISSING_DOCUMENTS")).toBe(true);
  });
});
