import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, customerCtx } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";

// user.id FK on commitment.committed_by_user_id / customer_update.published_by — same override
// as commitments/core.test.ts and handover.test.ts's own superAdminCtx (a real seeded demo user,
// not ctxWithRoles()'s synthetic "test_user" id).
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
import { createBooking } from "../bookings";
import { acceptBooking } from "../bookings-crm";
import { listDemands } from "../demands";
import { postReceipt } from "../demands-receipts";
import { assertNoDenylistedKeys } from "./denylist";
import {
  getOverview, getJourney, getMyHome, getPayments, getDocuments, getRegistrationArea, getHandoverArea,
  getRequests, raiseCustomerRequest, getCommitments, getPassport, getUpdates, sendCheckIn, submitCheckIn,
  listDraftUpdates, publishUpdate, uploadCustomerDocument,
} from "./core";
import { confirmAvailability } from "../registration/core";

const completeInput = {
  applicant: { display_name: "Priya Nair", phone: "9876512345", pan: "PORTL1234A" },
  total_consideration: 9800000,
  docs: [
    { type: "PAN card", received: true },
    { type: "Address proof", received: true },
    { type: "Photograph", received: true },
  ],
};

let nodeId: string;
let unitCounter = 0;

beforeAll(async () => {
  await initDb();
  const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE project_id = 'p_eastcrest' LIMIT 1`);
  nodeId = node.rows[0]!.id;
});

/** Same "insert a fresh available unit per test" precedent as forecast.test.ts's own
 *  `freshBooking` — the seeded East Crest project has only 7 villa units, nowhere near enough
 *  for this file's ~11 independent bookings. Creates a real booking + a real customer_login/user
 *  row for it, returning a ready-to-use CUSTOMER ctx. */
async function freshCustomerBooking() {
  const unitId = `u_portal_test_${unitCounter++}`;
  await db.query(
    `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id, product_type, sale_status)
     VALUES ($1,'p_eastcrest',$2,'3BHK','EAST',$3,$4,'VILLA','available')`,
    [unitId, `PT-${unitCounter}`, `U-PT${unitCounter}`, nodeId]
  );
  const b = await createBooking(unitId, { ...completeInput, applicant: { ...completeInput.applicant, phone: `98765${String(10000 + unitCounter)}` } }, superAdminCtx);
  await acceptBooking(b.id, superAdminCtx);
  const applicant = await db.query<{ customer_id: string }>(`SELECT customer_id FROM booking_applicant WHERE booking_id = $1 AND role = 'primary'`, [b.id]);
  const userId = "cu_" + randomUUID().slice(0, 8);
  await db.query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ($1,$2,'Priya Nair','ACTIVE','CUSTOMER')`, [userId, `${userId}@test.local`]);
  await db.query(`INSERT INTO customer_login (user_id, customer_id, booking_id) VALUES ($1,$2,$3)`, [userId, applicant.rows[0].customer_id, b.id]);
  return { bookingId: b.id, unitId, ctx: customerCtx(userId) };
}

describe("26-customer-portal — projection, not permission (rule 2)", () => {
  it("every area's response is free of denylisted keys", async () => {
    const { ctx } = await freshCustomerBooking();
    for (const fn of [getOverview, getJourney, getMyHome, getPayments, getDocuments, getRegistrationArea, getHandoverArea, getRequests, getCommitments, getPassport, getUpdates]) {
      const result = await fn(ctx);
      expect(() => assertNoDenylistedKeys(result)).not.toThrow();
    }
  });

  it("200 pseudo-random denylist-tripwire objects are all caught (proves the checker itself works)", () => {
    const denylisted = ["owner_user_id", "root_cause", "vendor", "internal_note", "forecast_confidence"];
    for (let i = 0; i < 200; i++) {
      const key = denylisted[i % denylisted.length];
      expect(() => assertNoDenylistedKeys({ safe: "ok", nested: { [key]: "leak" } })).toThrow();
    }
  });
});

describe("26 rule 1 — identity: a customer only ever resolves to their own booking", () => {
  it("404s a login with no booking, and never falls back to any other booking", async () => {
    const userId = "cu_orphan_" + randomUUID().slice(0, 6);
    await db.query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ($1,$2,'Orphan','ACTIVE','CUSTOMER')`, [userId, `${userId}@test.local`]);
    await expect(getOverview(customerCtx(userId))).rejects.toThrow("no booking found");
  });

  it("a STAFF ctx cannot call portal area functions at all", async () => {
    await expect(getOverview(superAdminCtx)).rejects.toThrow("portal access requires a customer login");
  });
});

describe("26 rule 4 — journey area (06's customer layer)", () => {
  it("returns customer wording, not internal stage status codes", async () => {
    const { ctx } = await freshCustomerBooking();
    const j = await getJourney(ctx);
    expect(j).toHaveProperty("stages");
    expect(j).toHaveProperty("actions_required");
    for (const s of j.stages) expect(["On track", "Not started", "In progress", "Needs your action", "Completed", "Not applicable"]).toContain(s.status);
  });
});

describe("26 rule 5 — payments area (reuses transparency.ts::t2Payments)", () => {
  it("shows schedule, paid total, and TDS/loan projections with no raw milestone codes", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    const due = (await listDemands(bookingId)).find((d) => d.status === "due")!;
    await postReceipt(due.id, { amount: due.amount, mode: "neft" }, superAdminCtx);
    const p = await getPayments(ctx);
    expect(p!.paid_total).toBeGreaterThan(0);
    expect(p).toHaveProperty("tds");
    expect(p).toHaveProperty("loan_summary");
    expect(() => assertNoDenylistedKeys(p)).not.toThrow();
  });
});

describe("26 rule 6 — documents: uploading a required document", () => {
  it("marks the customer_document RECEIVED and records customer.action_completed", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    const applicant = await db.query<{ customer_id: string }>(`SELECT customer_id FROM customer_login WHERE user_id = $1`, [ctx.actor.user_id]);
    const docId = "cd_" + randomUUID().slice(0, 8);
    // 22's own booking-creation checklist auto-seeds a PAN row for this booking already —
    // use a category it doesn't seed, so this insert doesn't collide with that real behaviour.
    await db.query(
      `INSERT INTO customer_document (id, booking_id, customer_id, category, verifier_role) VALUES ($1,$2,$3,'OTHER','CRM')`,
      [docId, bookingId, applicant.rows[0].customer_id]
    );
    await uploadCustomerDocument(docId, "application/pdf", ctx);
    const row = await db.query<{ status: string; file_keys: string[] }>(`SELECT status, file_keys FROM customer_document WHERE id = $1`, [docId]);
    expect(row.rows[0].status).toBe("VALIDATING");
    expect(row.rows[0].file_keys.length).toBe(1);
    const evt = await db.query(`SELECT type FROM event WHERE type = 'customer.action_completed' AND entity_id = $1`, [docId]);
    expect(evt.rows.length).toBe(1);
  });

  it("a customer cannot upload against another customer's document", async () => {
    const owner = await freshCustomerBooking();
    const applicant = await db.query<{ customer_id: string }>(`SELECT customer_id FROM customer_login WHERE user_id = $1`, [owner.ctx.actor.user_id]);
    const docId = "cd_" + randomUUID().slice(0, 8);
    await db.query(
      `INSERT INTO customer_document (id, booking_id, customer_id, category, verifier_role) VALUES ($1,$2,$3,'OTHER','CRM')`,
      [docId, owner.bookingId, applicant.rows[0].customer_id]
    );
    const other = await freshCustomerBooking();
    await expect(uploadCustomerDocument(docId, "application/pdf", other.ctx)).rejects.toThrow("not your document");
  });
});

describe("26 rule 8 — commitments: customer-facing only, wording not root cause", () => {
  it("only returns commitments flagged customer_facing, mapped to Committed/Delivered/Delayed", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    const b = await db.query<{ project_id: string; unit_id: string }>(`SELECT project_id, unit_id FROM booking WHERE id = $1`, [bookingId]);
    await db.query(
      `INSERT INTO commitment (id, code, project_id, booking_id, unit_id, category, description, committed_by_user_id, committed_at, source, beneficiary, customer_facing, status)
       VALUES ($1,'CM-TEST-1',$2,$3,$4,'SERVICE','Free modular kitchen upgrade','user_superadmin',now(),'CRM','CUSTOMER',true,'ACTIVE')`,
      [randomUUID(), b.rows[0].project_id, bookingId, b.rows[0].unit_id]
    );
    await db.query(
      `INSERT INTO commitment (id, code, project_id, booking_id, unit_id, category, description, committed_by_user_id, committed_at, source, beneficiary, customer_facing, status)
       VALUES ($1,'CM-TEST-2',$2,$3,$4,'OTHER','Internal vendor coordination note','user_superadmin',now(),'CRM','INTERNAL',false,'ACTIVE')`,
      [randomUUID(), b.rows[0].project_id, bookingId, b.rows[0].unit_id]
    );
    const commitments = await getCommitments(ctx);
    expect(commitments.length).toBe(1);
    expect(commitments[0].description).toBe("Free modular kitchen upgrade");
    expect(commitments[0].status).toBe("Committed");
  });
});

describe("26 rule 9 — Home Passport (reuses transparency.ts::t4Passport)", () => {
  it("returns equipment + as-built spec, flags service_history as not-yet-available (30 unbuilt)", async () => {
    const { ctx } = await freshCustomerBooking();
    const passport = await getPassport(ctx);
    expect(passport).toHaveProperty("equipment");
    expect(passport).toHaveProperty("as_built_spec");
    expect(passport.service_history).toEqual([]);
  });
});

describe("26 rule 7 — requests: customer can raise a real change request via 18's own flow", () => {
  it("raises a customisation request that appears in the customer's own requests list", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    const raised = await raiseCustomerRequest({ booking_id: bookingId, title: "Add a wardrobe" }, ctx);
    expect(raised.code).toMatch(/^CR-/);
    const requests = await getRequests(ctx);
    expect(requests.requests.some((r) => r.id === raised.id)).toBe(true);
  });
});

describe("26 rule 6 — registration/handover widening: a customer may act only on their own booking", () => {
  it("confirmAvailability (23) authorizes a CUSTOMER ctx on their own booking exactly like staff — same gate, no privilege bypass — and rejects another customer's booking outright", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    // Real readiness for this fresh booking is nowhere near READY (23's own registration.test.ts
    // drives that full documents/clearance/tds/AOS/deed pipeline) — the point here is the
    // authorization boundary this segment widened, not re-proving 23's readiness engine: the
    // owning customer must reach the exact same business-rule error a staff caller would, never a
    // silent bypass, and a DIFFERENT customer must be rejected before that check even runs.
    await expect(confirmAvailability(bookingId, ["2026-11-01", "2026-11-05"], ctx)).rejects.toThrow("gate_blocked");

    const other = await freshCustomerBooking();
    await expect(confirmAvailability(bookingId, ["2026-12-01"], other.ctx)).rejects.toThrow("customers may act only on their own booking");
  });
});

describe("26 rule 10 — check-ins", () => {
  it("sends a check-in, rejects an invalid score, accepts a valid one, and raises a CRM action on a low score", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    const sent = await sendCheckIn(bookingId, "DAY_7");
    const sentEvt = await db.query(`SELECT type FROM event WHERE type = 'check_in.sent' AND entity_id = $1`, [sent.id]);
    expect(sentEvt.rows.length).toBe(1);

    await expect(submitCheckIn(sent.id, { score: 9 }, ctx)).rejects.toThrow("between 1 and 5");
    await submitCheckIn(sent.id, { score: 2, comment: "Slow response from site team" }, ctx);
    const respondedEvt = await db.query(`SELECT type FROM event WHERE type = 'check_in.responded' AND entity_id = $1`, [sent.id]);
    expect(respondedEvt.rows.length).toBe(1);

    const row = await db.query<{ follow_up_action_id: string | null; score: number }>(`SELECT follow_up_action_id, score FROM customer_check_in WHERE id = $1`, [sent.id]);
    expect(row.rows[0].score).toBe(2);
    expect(row.rows[0].follow_up_action_id).toBeTruthy();
    await expect(submitCheckIn(sent.id, { score: 5 }, ctx)).rejects.toThrow("already answered");
  });

  it("a check-in cannot be answered by a different customer's login", async () => {
    const { bookingId } = await freshCustomerBooking();
    const other = await freshCustomerBooking();
    const sent = await sendCheckIn(bookingId, "DAY_30");
    await expect(submitCheckIn(sent.id, { score: 5 }, other.ctx)).rejects.toThrow("not found");
  });
});

describe("26 rule 10 — moments that matter: system drafts, CRM publishes, never auto-published", () => {
  it("a real payment event drafts a customer_update, invisible to the portal until CRM publishes it", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    const due = (await listDemands(bookingId)).find((d) => d.status === "due")!;
    await postReceipt(due.id, { amount: due.amount, mode: "neft" }, superAdminCtx);

    const drafts = await listDraftUpdates(bookingId, superAdminCtx);
    const draft = drafts.find((d) => d.kind === "PAYMENT_CONFIRMED" && d.status === "DRAFT");
    expect(draft).toBeTruthy();
    const draftedEvt = await db.query(`SELECT type FROM event WHERE type = 'customer_update.drafted' AND booking_id = $1`, [bookingId]);
    expect(draftedEvt.rows.length).toBeGreaterThan(0);

    // Not auto-published — invisible to the customer's own feed until CRM acts.
    expect((await getUpdates(ctx)).length).toBe(0);

    await publishUpdate(draft!.id, undefined, superAdminCtx);
    const updates = await getUpdates(ctx);
    expect(updates.some((u) => u.id === draft!.id)).toBe(true);

    await expect(publishUpdate(draft!.id, undefined, superAdminCtx)).rejects.toThrow("already published");
  });

  it("a customer cannot publish their own draft update", async () => {
    const { bookingId, ctx } = await freshCustomerBooking();
    const due = (await listDemands(bookingId)).find((d) => d.status === "due")!;
    await postReceipt(due.id, { amount: due.amount, mode: "neft" }, superAdminCtx);
    const drafts = await listDraftUpdates(bookingId, superAdminCtx);
    const draft = drafts.find((d) => d.kind === "PAYMENT_CONFIRMED")!;
    await expect(publishUpdate(draft.id, undefined, ctx)).rejects.toThrow();
  });
});
