import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createBooking, acceptBooking } from "../bookings";
import { createProject, createUnit } from "../projects";
import { openCommitmentsForBooking } from "./core";
import { evaluateHandover } from "../handover";
import {
  createCommitment,
  listCommitments,
  getCommitment,
  commitmentsForBooking,
  approveCommitment,
  activateCommitment,
  fulfilCommitment,
  waiveCommitment,
  setAtRisk,
  recordRecoveryPlan,
  recordRootCause,
  scanCommitments,
} from "./core";
import type { Ctx } from "../authz/types";

// 13-promise-ledger.md. Real seeded demo users (seed/users.ts) — commitment.committed_by_user_id/
// owner_user_id FK to "user"(id), same reason 12/21's own test files override ctxWithRoles()'s
// default synthetic "test_user" id.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const crm = () => ctxAs("user_crm", ["CRM"]);
const banking = () => ctxAs("user_banking", ["BANKING"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);
const sales = () => ctxAs("user_sales", ["SALES"]);

let PROJECT_ID: string;
let unitSeq = 0;

const fullDocs = [
  { type: "PAN card", received: true },
  { type: "Address proof", received: true },
  { type: "Photograph", received: true },
];

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "cmttest", name: "Commitments Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshBooking(): Promise<string> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `C-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "Cmt Test", phone: `9887766${String(unitSeq).padStart(3, "0")}`, pan: `CMTTU${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 5000000, docs: fullDocs },
    superAdminCtx
  );
  await acceptBooking(b!.id, superAdminCtx);
  return b!.id;
}

describe("createCommitment + lifecycle (rule 1)", () => {
  it("auto-approves a commitment that doesn't require approval, and activates once owner+due_date are set", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Provide extra parking marking", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, owner_user_id: "user_crm", due_date: "2099-01-01", approval_required: false },
      crm()
    );
    expect(c.status).toBe("APPROVED");
    expect(c.customer_id).toBeTruthy(); // resolved from booking_applicant via acceptBooking's customer.created

    const active = await activateCommitment(c.id, crm());
    expect(active.status).toBe("ACTIVE");

    const created = await db.query(`SELECT type FROM event WHERE type = 'commitment.created' AND entity_id = $1`, [c.id]);
    expect(created.rows.length).toBeGreaterThan(0);
    const statusChanged = await db.query(`SELECT type FROM event WHERE type = 'commitment.status_changed' AND entity_id = $1`, [c.id]);
    expect(statusChanged.rows.length).toBeGreaterThan(0);
  });

  it("activation fails without owner_user_id or due_date already set", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "No owner yet", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, approval_required: false },
      crm()
    );
    await expect(activateCommitment(c.id, crm())).rejects.toThrow(/owner_user_id/);
  });
});

describe("approval (rule 2) — MANAGEMENT for high financial impact / COMMERCIAL-TIMELINE, CRM lead otherwise", () => {
  it("starts DRAFT when approval_required, rejects self-approval, and MANAGEMENT (the resolved approver role) can approve", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "COMMERCIAL", description: "Waive one late fee", source: "CRM", beneficiary: "CUSTOMER", customer_facing: true, financial_impact_inr: 50000, approval_required: true },
      crm()
    );
    expect(c.status).toBe("DRAFT");

    await expect(approveCommitment(c.id, crm())).rejects.toThrow(/cannot approve your own commitment/);
    const approved = await approveCommitment(c.id, management());
    expect(approved.status).toBe("APPROVED");
    expect(approved.approved_by).toBe("user_management");

    await expect(approveCommitment(c.id, management())).rejects.toThrow(/not awaiting approval/);
  });

  it("a small, non-COMMERCIAL/TIMELINE commitment's approver defaults to CRM, so matrix WRITE (CRM, not the creator) can approve it", async () => {
    const bookingId = await freshBooking();
    // Created by SUPER_ADMIN (source tag is still MANAGEMENT) so the approver check below is
    // exercised against a real, different actor — CRM itself can never approve its own creation.
    const c = await createCommitment(
      { booking_id: bookingId, category: "MODIFICATION", description: "Extra shelf", source: "MANAGEMENT", beneficiary: "CUSTOMER", customer_facing: true, financial_impact_inr: 1000, approval_required: true },
      superAdminCtx
    );
    expect(c.status).toBe("DRAFT");
    const approved = await approveCommitment(c.id, crm()); // CRM lead — matrix WRITE, not the creator
    expect(approved.status).toBe("APPROVED");
  });
});

describe("rule 7 (as the seeded matrix enforces it) — CRM writes; the owner self-guard; MANAGEMENT waives", () => {
  it("BANKING can read but not create; the commitment's own owner may fulfil it without matrix WRITE", async () => {
    const bookingId = await freshBooking();
    await expect(
      createCommitment({ booking_id: bookingId, category: "OTHER", description: "x", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, approval_required: false }, banking())
    ).rejects.toThrow();

    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Fix the balcony grille", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, owner_user_id: "user_sales", due_date: "2099-01-01", approval_required: false },
      crm()
    );
    await activateCommitment(c.id, crm());

    await expect(fulfilCommitment(c.id, { evidence_file_ids: [] }, banking())).rejects.toThrow(/evidence/);
    await expect(fulfilCommitment(c.id, { evidence_file_ids: ["file_1"] }, banking())).rejects.toThrow(); // not the owner, matrix READ only
    const fulfilled = await fulfilCommitment(c.id, { evidence_file_ids: ["file_1"] }, sales()); // IS the owner
    expect(fulfilled.status).toBe("FULFILLED");
    const evt = await db.query(`SELECT type FROM event WHERE type = 'commitment.fulfilled' AND entity_id = $1`, [c.id]);
    expect(evt.rows.length).toBeGreaterThan(0);
  });

  it("waiving requires matrix WRITE (CRM) or MANAGEMENT, not a plain READ role", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "To be waived", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, approval_required: false },
      crm()
    );
    await expect(waiveCommitment(c.id, "no longer needed", banking())).rejects.toThrow();
    const waived = await waiveCommitment(c.id, "no longer needed", management());
    expect(waived.status).toBe("WAIVED_CANCELLED");
    expect(waived.waived_reason).toBe("no longer needed");
    const evt = await db.query(`SELECT type FROM event WHERE type = 'commitment.waived' AND entity_id = $1`, [c.id]);
    expect(evt.rows.length).toBeGreaterThan(0);
  });
});

describe("customer-facing fulfilment (rule 1) needs confirmation", () => {
  it("rejects fulfil with evidence only; accepts with a CRM confirmation note", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "SERVICE", description: "Free AMC year 1", source: "CRM", beneficiary: "CUSTOMER", customer_facing: true, owner_user_id: "user_crm", due_date: "2099-01-01", approval_required: false },
      crm()
    );
    await activateCommitment(c.id, crm());
    await expect(fulfilCommitment(c.id, { evidence_file_ids: ["file_1"] }, crm())).rejects.toThrow(/customer-facing/);
    const fulfilled = await fulfilCommitment(c.id, { evidence_file_ids: ["file_1"], crm_confirmation_note: "Customer confirmed over call" }, crm());
    expect(fulfilled.status).toBe("FULFILLED");
  });
});

describe("scanCommitments — rules 3 & 4: pre-breach AT_RISK and automatic BREACHED", () => {
  it("flags an ACTIVE commitment AT_RISK once within the lead window, and raises a pre-breach action for the owner", async () => {
    const bookingId = await freshBooking();
    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 3 days out — within the 7-day lead
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Deliver keys to the customer's parents", source: "CRM", beneficiary: "CUSTOMER", customer_facing: true, owner_user_id: "user_sales", due_date: dueDate, approval_required: false },
      crm()
    );
    await activateCommitment(c.id, crm());

    const result = await scanCommitments();
    expect(result.atRisk).toContain(c.id);

    const after = await getCommitment(c.id, crm());
    expect(after.status).toBe("AT_RISK");
    expect(after.at_risk_reason).toBeTruthy();

    const action = await db.query(`SELECT id FROM action WHERE source_entity_type = 'commitment' AND source_entity_id = $1`, [c.id]);
    expect(action.rows.length).toBeGreaterThan(0);

    const evt = await db.query(`SELECT type FROM event WHERE type = 'commitment.at_risk' AND entity_id = $1`, [c.id]);
    expect(evt.rows.length).toBeGreaterThan(0);
  });

  it("breaches an ACTIVE commitment automatically once its due_date has passed", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Past-due promise", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, owner_user_id: "user_crm", due_date: "2020-01-01", approval_required: false },
      crm()
    );
    await activateCommitment(c.id, crm());
    const result = await scanCommitments();
    expect(result.breached).toContain(c.id);
    const after = await getCommitment(c.id, crm());
    expect(after.status).toBe("BREACHED");

    const recorded = await recordRootCause(c.id, "OVERPROMISED", crm());
    expect(recorded.breach_root_cause).toBe("OVERPROMISED");

    const evt = await db.query(`SELECT type FROM event WHERE type = 'commitment.breached' AND entity_id = $1`, [c.id]);
    expect(evt.rows.length).toBeGreaterThan(0);
  });
});

describe("recovery plan (rule 3)", () => {
  it("can only be recorded while AT_RISK, and requires both a plan and a due date", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Needs a recovery plan", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, owner_user_id: "user_crm", due_date: "2099-01-01", approval_required: false },
      crm()
    );
    await activateCommitment(c.id, crm());
    await expect(recordRecoveryPlan(c.id, "Escalate to vendor", "2099-06-01", crm())).rejects.toThrow(/AT_RISK/);

    await setAtRisk(c.id, "vendor delay", crm());
    const withPlan = await recordRecoveryPlan(c.id, "Escalate to vendor", "2099-06-01", crm());
    expect(withPlan.recovery_plan).toBe("Escalate to vendor");
    expect(withPlan.recovery_due_date).toBe("2099-06-01");
  });
});

describe("listCommitments / commitmentsForBooking / getCommitment expose a computed confidence", () => {
  it("returns a 0-100 confidence with drivers, not stored on the row", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Confidence check", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, owner_user_id: "user_crm", due_date: "2099-01-01", approval_required: false },
      crm()
    );
    const viaGet = await getCommitment(c.id, crm());
    expect(viaGet.confidence).toBeGreaterThanOrEqual(0);
    expect(viaGet.confidence).toBeLessThanOrEqual(100);
    expect(Array.isArray(viaGet.confidence_drivers)).toBe(true);

    const viaList = await listCommitments({ project_id: PROJECT_ID }, crm());
    expect(viaList.some((v) => v.id === c.id)).toBe(true);

    const viaBooking = await commitmentsForBooking(bookingId, crm());
    expect(viaBooking.some((v) => v.id === c.id)).toBe(true);
  });
});

describe("getCommitment's transitions history (13-promise-ledger.md Screens: detail drawer timeline)", () => {
  it("returns the real commitment_transition rows in order, not just the current row", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Timeline check", source: "CRM", beneficiary: "INTERNAL", customer_facing: false, owner_user_id: "user_crm", due_date: "2099-01-01", approval_required: false },
      crm()
    );
    await activateCommitment(c.id, crm());
    await setAtRisk(c.id, "vendor delay", crm());
    await fulfilCommitment(c.id, { evidence_file_ids: ["file_1"] }, crm());

    const detail = await getCommitment(c.id, crm());
    expect(detail.transitions.map((t) => `${t.from_status}->${t.to_status}`)).toEqual([
      "APPROVED->ACTIVE",
      "ACTIVE->AT_RISK",
      "AT_RISK->FULFILLED",
    ]);
    expect(detail.transitions[1].reason).toBe("vendor delay");
  });
});

describe("rule 8 — handover gate integration (replaces PR #7's 'Not verified')", () => {
  it("an ACTIVE commitment opens the commitments gate with its own code+description as the blocker; fulfilling it passes the gate", async () => {
    const bookingId = await freshBooking();
    const c = await createCommitment(
      { booking_id: bookingId, category: "OTHER", description: "Install a second door lock", source: "CRM", beneficiary: "CUSTOMER", customer_facing: false, owner_user_id: "user_crm", due_date: "2099-01-01", approval_required: false },
      crm()
    );
    await activateCommitment(c.id, crm());

    const openBefore = await openCommitmentsForBooking(bookingId);
    const before = evaluateHandover({
      readiness_value: 100, readiness_threshold: 80, utilities_ready: true, critical_snags: 0, minor_snags: 0, minor_snag_max: 2,
      qa_approved: true, financial_cleared: true, legal_executed: true, registered: true, open_commitments: openBefore,
    });
    const gateBefore = before.gates.find((g) => g.type === "commitments")!;
    expect(gateBefore.state).toBe("open");
    expect(gateBefore.blockers).toEqual([`${c.code}: Install a second door lock`]);
    // 16-handover-gates.md p17 §9 (verbatim from the client PDF): Commitments is HARD, not soft
    // as this test previously asserted — an open commitment now blocks eligibility.
    expect(before.eligible).toBe(false);

    await fulfilCommitment(c.id, { evidence_file_ids: ["file_1"] }, crm());
    const openAfter = await openCommitmentsForBooking(bookingId);
    const after = evaluateHandover({
      readiness_value: 100, readiness_threshold: 80, utilities_ready: true, critical_snags: 0, minor_snags: 0, minor_snag_max: 2,
      qa_approved: true, financial_cleared: true, legal_executed: true, registered: true, open_commitments: openAfter,
    });
    const gateAfter = after.gates.find((g) => g.type === "commitments")!;
    expect(gateAfter.state).toBe("passed");
  });
});
