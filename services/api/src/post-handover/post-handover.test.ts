import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db, initDb } from "../db";
import { createBooking } from "../bookings";
import { acceptBooking } from "../bookings-crm";
import { submitCheckIn } from "../portal/core";
import { superAdminCtx as fakeSuperAdminCtx, customerCtx, ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { openPostHandoverCase, getPostHandoverCase, completeMoveInTask, sweepDlpClosure, getUnitPassport } from "./core";
import {
  createWarrantyCase, triageWarrantyCase, assignWarrantyCase, quoteWarrantyCase, acceptQuote, waiveQuote,
  startWarrantyCase, resolveWarrantyCase, verifyWarrantyCase, closeWarrantyCase, rejectWarrantyCase, computeCoverage,
} from "./warranty";
import { inviteAdvocacy, respondAdvocacy } from "./advocacy";

// 30-post-handover.md rules 1-7. Real seeded "user" ids (seed/users.ts) — several inserts here
// FK to "user" — same convention every prior spec's own tests established.
const fm: Ctx = { actor: { ...ctxWithRoles(["FM"]).actor, user_id: "user_fm" } };
const crm: Ctx = { actor: { ...ctxWithRoles(["CRM"]).actor, user_id: "user_crm" } };

let unitCounter = 0;
let nodeId: string;

beforeAll(async () => {
  await initDb();
  const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE project_id = 'p_eastcrest' LIMIT 1`);
  nodeId = node.rows[0]!.id;
  await db.query(`INSERT INTO contractor (id, name, trade) VALUES ('con_a', 'Test Contractor', 'general') ON CONFLICT (id) DO NOTHING`);
});

/** Same "insert a fresh unit + booking per test" precedent as portal.test.ts's own
 *  `freshCustomerBooking` — reused here rather than driving a booking through the full
 *  registration/legal/QA/handover gate chain, which is out of scope for this spec's own tests. */
async function freshHandoverBooking() {
  const unitId = `u_ph_test_${unitCounter++}`;
  await db.query(
    `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id, product_type, sale_status)
     VALUES ($1,'p_eastcrest',$2,'3BHK','EAST',$3,$4,'VILLA','available')`,
    [unitId, `PH-${unitCounter}`, `U-PH${unitCounter}`, nodeId]
  );
  const b = await createBooking(unitId, {
    applicant: { display_name: "Rohan Desai", phone: `98760${String(10000 + unitCounter)}`, pan: "PHTST1234A" },
    total_consideration: 9800000,
    docs: [{ type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true }],
  }, fakeSuperAdminCtx);
  await acceptBooking(b.id, fakeSuperAdminCtx);
  const applicant = await db.query<{ customer_id: string }>(`SELECT customer_id FROM booking_applicant WHERE booking_id = $1 AND role = 'primary'`, [b.id]);
  const userId = "cu_" + randomUUID().slice(0, 8);
  await db.query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ($1,$2,'Rohan Desai','ACTIVE','CUSTOMER')`, [userId, `${userId}@test.local`]);
  await db.query(`INSERT INTO customer_login (user_id, customer_id, booking_id) VALUES ($1,$2,$3)`, [userId, applicant.rows[0].customer_id, b.id]);
  return { bookingId: b.id, unitId, ctx: customerCtx(userId) };
}

describe("30 rule 1 — post-handover case opens on handover.completed", () => {
  it("creates the case, 7 move-in-task actions, and schedules 26's real check-ins", async () => {
    const { bookingId, unitId } = await freshHandoverBooking();
    const caseId = await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const again = await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    expect(again).toBe(caseId); // idempotent

    const view = await getPostHandoverCase(bookingId, fm);
    expect(view.status).toBe("ONBOARDING");
    const taskKeys = Object.keys(view.move_in_tasks);
    expect(taskKeys).toHaveLength(7);
    for (const key of taskKeys) expect(view.move_in_tasks[key as keyof typeof view.move_in_tasks].action_id).toBeTruthy();

    const actions = await db.query<{ count: string }>(`SELECT count(*)::text FROM action WHERE source_entity_type = 'post_handover_case' AND source_entity_id = $1`, [caseId]);
    expect(Number(actions.rows[0]!.count)).toBe(7);

    const checkins = await db.query<{ kind: string }>(`SELECT kind FROM customer_check_in WHERE booking_id = $1 ORDER BY kind`, [bookingId]);
    expect(checkins.rows.map((r) => r.kind).sort()).toEqual(["DAY_30", "DAY_7", "DAY_90"]);

    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'post_handover_case' AND entity_id = $1 AND type = 'post_handover.case_opened'`, [caseId]);
    expect(ev.rows[0]?.type).toBe("post_handover.case_opened");
  });

  it("completing every move-in task flips the case to IN_DLP and fires onboarding_completed", async () => {
    const { bookingId, unitId } = await freshHandoverBooking();
    const caseId = await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const view = await getPostHandoverCase(bookingId, fm);
    const keys = Object.keys(view.move_in_tasks) as (keyof typeof view.move_in_tasks)[];
    for (const key of keys) await completeMoveInTask(caseId, key, fm);

    const after = await getPostHandoverCase(bookingId, fm);
    expect(after.status).toBe("IN_DLP");
    expect(Object.values(after.move_in_tasks).every((t) => t.done)).toBe(true);
    const closedActions = await db.query<{ count: string }>(`SELECT count(*)::text FROM action WHERE source_entity_id = $1 AND status = 'Closed'`, [caseId]);
    expect(Number(closedActions.rows[0]!.count)).toBe(7);
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'post_handover_case' AND entity_id = $1 AND type = 'post_handover.onboarding_completed'`, [caseId]);
    expect(ev.rows[0]?.type).toBe("post_handover.onboarding_completed");
    const taskEv = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'post_handover_case' AND entity_id = $1 AND type = 'post_handover.move_in_task_completed'`, [caseId]);
    expect(taskEv.rows[0]?.type).toBe("post_handover.move_in_task_completed");
  });
});

describe("30 rule 2/3 — warranty case lifecycle", () => {
  it("an in-coverage case goes open -> triaged -> assigned -> in_progress -> resolved -> closed, with a real SLA clock and service record", async () => {
    const { bookingId, unitId } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const created = await createWarrantyCase({ unit_id: unitId, booking_id: bookingId, category: "ELECTRICAL", trade: "electrical", severity: "MAJOR", description: "Socket not working" }, fm);
    expect(created.status).toBe("open");
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'warranty_case' AND entity_id = $1`, [created.id]);
    expect(ev.rows[0]?.type).toBe("warranty.case_opened");

    const triaged = await triageWarrantyCase(created.id, fm);
    expect(triaged.status).toBe("triaged");
    expect(triaged.in_coverage).toBe(true); // handover just happened — well within the 12mo ELECTRICAL window
    expect(triaged.sla_clock_id).toBeTruthy();
    const clock = await db.query<{ policy_id: string }>(`SELECT policy_id FROM sla_clock WHERE id = $1`, [triaged.sla_clock_id]);
    expect(clock.rows[0]?.policy_id).toBe("warranty_major");

    const assigned = await assignWarrantyCase(created.id, "con_a", fm);
    expect(assigned.status).toBe("assigned");
    const started = await startWarrantyCase(created.id, ["before1.jpg"], fm);
    expect(started.status).toBe("in_progress");
    const resolved = await resolveWarrantyCase(created.id, { cost_inr: 0, root_cause_code: "WORKMANSHIP", after_file_keys: ["after1.jpg"] }, fm);
    expect(resolved.status).toBe("resolved");
    const service = await db.query<{ kind: string }>(`SELECT kind FROM service_history WHERE warranty_case_id = $1`, [created.id]);
    expect(service.rows[0]?.kind).toBe("WARRANTY_FIX");

    const closed = await closeWarrantyCase(created.id, fm);
    expect(closed.status).toBe("closed");
    const closedEv = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'warranty_case' AND entity_id = $1 AND type = 'warranty.case_closed'`, [created.id]);
    expect(closedEv.rows[0]?.type).toBe("warranty.case_closed");
  });

  it("a customer-raised case cannot close without customer verification", async () => {
    const { bookingId, unitId, ctx } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const created = await createWarrantyCase({ unit_id: unitId, booking_id: bookingId, category: "PLUMBING", trade: "plumbing", severity: "MINOR", description: "Tap leaking", raised_by_kind: "CUSTOMER_PORTAL" }, fm);
    await triageWarrantyCase(created.id, fm);
    await assignWarrantyCase(created.id, "con_a", fm);
    await startWarrantyCase(created.id, [], fm);
    await resolveWarrantyCase(created.id, {}, fm);
    await expect(closeWarrantyCase(created.id, fm)).rejects.toThrow(/customer verification/);
    const verified = await verifyWarrantyCase(created.id, ctx);
    expect(verified.customer_verified_at).toBeTruthy();
    const closed = await closeWarrantyCase(created.id, fm);
    expect(closed.status).toBe("closed");
  });

  it("out-of-coverage work needs an accepted quote or an FM waiver before it can be assigned", async () => {
    const { bookingId, unitId } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    // computeCoverage directly, with an asOf far past every seeded window — proves the "expired" branch.
    const coverage = await computeCoverage("ELECTRICAL", new Date(0).toISOString(), null, "p_eastcrest", "VILLA", db, new Date());
    expect(coverage.in_coverage).toBe(false);
    expect(coverage.coverage_basis).toBe("EXPIRED");

    const created = await createWarrantyCase({ unit_id: unitId, booking_id: bookingId, category: "COSMETIC", trade: "painting", severity: "MINOR", description: "Paint chip" }, fm);
    const triaged = await triageWarrantyCase(created.id, fm); // no dlp_policy category matches "COSMETIC" — falls to out-of-coverage
    expect(triaged.in_coverage).toBe(false);
    await quoteWarrantyCase(created.id, 1500, fm);
    const quoteEv = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'warranty_case' AND entity_id = $1 AND type = 'warranty.quote_issued'`, [created.id]);
    expect(quoteEv.rows[0]?.type).toBe("warranty.quote_issued");
    await expect(assignWarrantyCase(created.id, "con_a", fm)).rejects.toThrow(/accepted quote or an FM waiver/);
    const accepted = await acceptQuote(created.id, fm);
    expect(accepted.quote_accepted_at).toBeTruthy();
    const acceptEv = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'warranty_case' AND entity_id = $1 AND type = 'warranty.quote_accepted'`, [created.id]);
    expect(acceptEv.rows[0]?.type).toBe("warranty.quote_accepted");
    const assigned = await assignWarrantyCase(created.id, "con_a", fm);
    expect(assigned.status).toBe("assigned");
  });

  it("an FM waiver also unblocks assignment without a customer acceptance", async () => {
    const { bookingId, unitId } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const created = await createWarrantyCase({ unit_id: unitId, booking_id: bookingId, category: "COSMETIC", trade: "painting", severity: "MINOR", description: "Scuff mark" }, fm);
    await triageWarrantyCase(created.id, fm);
    await quoteWarrantyCase(created.id, 800, fm);
    await waiveQuote(created.id, "Goodwill gesture — customer flagged at walkthrough", fm);
    const assigned = await assignWarrantyCase(created.id, "con_a", fm);
    expect(assigned.status).toBe("assigned");
  });

  it("rejects a case with a reason", async () => {
    const { bookingId, unitId } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const created = await createWarrantyCase({ unit_id: unitId, booking_id: bookingId, category: "ELECTRICAL", trade: "electrical", severity: "MINOR", description: "Not a real defect" }, fm);
    const rejected = await rejectWarrantyCase(created.id, "Customer damage, not a manufacturing defect", fm);
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejected_reason).toBeTruthy();
  });
});

describe("30 rule 7 — DLP closure sweep", () => {
  it("closes the case once every window has expired and no cases remain open, and schedules the DLP_CLOSE check-in", async () => {
    const { bookingId, unitId, ctx } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    // Move to IN_DLP first — sweepDlpClosure only considers IN_DLP cases.
    const view = await getPostHandoverCase(bookingId, fm);
    for (const key of Object.keys(view.move_in_tasks) as (keyof typeof view.move_in_tasks)[]) await completeMoveInTask((await getPostHandoverCase(bookingId, fm)).id, key, fm);

    const farFuture = new Date();
    farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 10); // past even the 60mo STRUCTURAL window
    const result = await sweepDlpClosure(farFuture);
    expect(result.closed.length).toBeGreaterThan(0);
    const after = await getPostHandoverCase(bookingId, fm);
    expect(after.status).toBe("DLP_CLOSED");
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'post_handover_case' AND entity_id = $1 AND type = 'dlp.window_expired'`, [after.id]);
    expect(ev.rows[0]?.type).toBe("dlp.window_expired");
    const dlpCheckIn = await db.query<{ id: string }>(`SELECT id FROM customer_check_in WHERE booking_id = $1 AND kind = 'DLP_CLOSE'`, [bookingId]);
    expect(dlpCheckIn.rows[0]?.id).toBeTruthy();

    // Rule 7's second half: responding to the DLP_CLOSE check-in completes the case.
    await submitCheckIn(dlpCheckIn.rows[0]!.id, { score: 5 }, ctx);
    const closed = await getPostHandoverCase(bookingId, fm);
    expect(closed.status).toBe("CLOSED");
  });

  it("does not close while a warranty case is still open", async () => {
    const { bookingId, unitId } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const view = await getPostHandoverCase(bookingId, fm);
    for (const key of Object.keys(view.move_in_tasks) as (keyof typeof view.move_in_tasks)[]) await completeMoveInTask((await getPostHandoverCase(bookingId, fm)).id, key, fm);
    await createWarrantyCase({ unit_id: unitId, booking_id: bookingId, category: "ELECTRICAL", trade: "electrical", severity: "MINOR", description: "Still open" }, fm);

    const farFuture = new Date();
    farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 10);
    const result = await sweepDlpClosure(farFuture);
    const after = await getPostHandoverCase(bookingId, fm);
    expect(after.status).toBe("IN_DLP"); // blocked by the open case
    expect(result.closed).not.toContain(after.id);
  });
});

describe("30 rule 9 (passport)", () => {
  it("lists passport items for a unit", async () => {
    const { unitId } = await freshHandoverBooking();
    await openPostHandoverCase((await db.query<{ id: string }>(`SELECT id FROM booking WHERE unit_id = $1`, [unitId])).rows[0]!.id, unitId, "p_eastcrest");
    const items = await getUnitPassport(unitId, fm);
    expect(Array.isArray(items)).toBe(true);
  });
});

describe("30 rule 6 — advocacy (CRM-only invite/publish)", () => {
  it("CRM invites, then records a REFERRAL response that creates a real prospect (24)", async () => {
    const { bookingId } = await freshHandoverBooking();
    const invited = await inviteAdvocacy(bookingId, "REFERRAL", crm);
    expect(invited.status).toBe("INVITED");
    const inviteEv = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'advocacy' AND entity_id = $1 AND type = 'advocacy.invited'`, [invited.id]);
    expect(inviteEv.rows[0]?.type).toBe("advocacy.invited");
    const responded = await respondAdvocacy(invited.id, { status: "RECEIVED", referred_prospect_name: "Anita Rao" }, crm);
    expect(responded.status).toBe("RECEIVED");
    expect(responded.referred_prospect_id).toBeTruthy();
    const prospect = await db.query<{ source: string }>(`SELECT source FROM prospect WHERE id = $1`, [responded.referred_prospect_id]);
    expect(prospect.rows[0]?.source).toBe("REFERRAL");
    const respondEv = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'advocacy' AND entity_id = $1 AND type = 'advocacy.received'`, [invited.id]);
    expect(respondEv.rows[0]?.type).toBe("advocacy.received");
  });

  it("a role outside CRM/MANAGEMENT/SUPER_ADMIN cannot invite", async () => {
    const { bookingId } = await freshHandoverBooking();
    await expect(inviteAdvocacy(bookingId, "TESTIMONIAL", fm)).rejects.toThrow(/requires one of/);
  });

  it("a DAY_90 score >= 4 raises a real CRM action nudging an advocacy invite (rule 6's trigger, not its send)", async () => {
    const { bookingId, unitId, ctx } = await freshHandoverBooking();
    await openPostHandoverCase(bookingId, unitId, "p_eastcrest");
    const day90 = (await db.query<{ id: string }>(`SELECT id FROM customer_check_in WHERE booking_id = $1 AND kind = 'DAY_90'`, [bookingId])).rows[0]!;
    await submitCheckIn(day90.id, { score: 5 }, ctx);
    const action = await db.query<{ count: string }>(`SELECT count(*)::text FROM action WHERE source_module = 'advocacy' AND source_entity_id = $1`, [day90.id]);
    expect(Number(action.rows[0]!.count)).toBe(1);
  });
});
