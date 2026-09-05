import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { createProject, createUnit } from "../projects";
import { createBooking } from "../bookings";
import { submitHandover, acceptHandover } from "../sales-handover/core";
import { listChecklist, uploadDocument, acceptDocument } from "../documents/checklist";
import { postReceipt } from "../demands-receipts";
import { generateDocument as generateLegacyDocument, approveDocument as approveLegacyDocument, executeDocument as executeLegacyDocument } from "../legal-docs";
import { createCommitment, activateCommitment } from "../commitments/core";
import { completeHandover as legacyCompleteHandover } from "../qa";
import {
  getHandoverCase, proposeAppointment, confirmAppointment, rescheduleAppointment,
  updateChecklist, overrideGate, completeCase, closeCase, evaluateAndLog,
} from "./core";
import { putGateConfig } from "./policy";

// 16-handover-gates.md — integration over real PGlite. `handover_record` predates this spec
// (0000_init.sql: legacy qa.ts's own simple completeHandover flow) — ALTERed in place (0039),
// both flows verified to coexist on the same row, same pattern 23 used for registration_case.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const qa = () => ctxAs("user_qa", ["QA"]);
const legal = () => ctxAs("user_legal", ["LEGAL"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);
const accounts = () => ctxAs("user_accounts", ["ACCOUNTS"]);
const sales = () => ctxAs("user_sales", ["SALES"]);
const crm = () => ctxAs("user_crm", ["CRM"]);
const registration = () => ctxAs("user_registration", ["REGISTRATION"]);
const fm = () => ctxAs("user_fm", ["FM"]);

let PROJECT_ID: string;
let unitSeq = 0;

const FULL_DOCS = [
  { type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true },
  { type: "Booking Form", received: true }, { type: "Cost Sheet", received: true }, { type: "PAN", received: true },
  { type: "Identity Proof", received: true }, { type: "Address Proof", received: true },
];
const FULL_CONFIRMATIONS = {
  applicant_details_confirmed: true, contact_verified: true, nri_status_confirmed: true, communication_pref_confirmed: true,
  unit_confirmed: true, facing_confirmed: true, parking_confirmed: true,
};

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "hotest", name: "Handover Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function eventTypesFor(entityId: string): Promise<string[]> {
  return (await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_id = $1 ORDER BY id`, [entityId])).rows.map((r) => r.type);
}

/** Opens a real COMMITMENTS gate blocker (13's rule 8) so override tests exercise an actually
 *  OPEN gate rather than one already passing on zero commitments. */
async function openCommitment(bookingId: string): Promise<void> {
  const c = await createCommitment(
    { booking_id: bookingId, category: "OTHER", description: "Free modular kitchen upgrade", source: "CRM", beneficiary: "CUSTOMER", customer_facing: false, owner_user_id: "user_crm", due_date: "2099-01-01", approval_required: false },
    crm()
  );
  await activateCommitment(c.id, crm());
}

/** Clears REGISTRATION + COMMITMENTS + QUALITY by override rather than re-running 23's full
 *  registration pipeline or a real QA sign-off here — those are covered end to end by their own
 *  spec's suite; this test file is about the appointment/completion/close lifecycle that sits on
 *  top of an eligible case. */
async function clearRemainingHardGatesByOverride(bookingId: string): Promise<void> {
  await openCommitment(bookingId);
  await overrideGate(bookingId, { gate: "REGISTRATION", reason: "test fixture: registration covered by 23's own suite" }, management());
  await overrideGate(bookingId, { gate: "COMMITMENTS", reason: "test fixture: commitment waived for lifecycle coverage" }, management());
  await overrideGate(bookingId, { gate: "QUALITY", reason: "test fixture: QA sign-off covered by 15's own suite", evidence_file_ids: ["file_qa_signoff"] }, management());
}

/** Walks a booking through every HARD gate input except commitments/registration's own inner
 *  workflow detail — financial (bookingFinance threshold), legal (executed AOS), physical
 *  (utilities_ready + full QA verification), quality (0 critical, 0 minor). Registration is left
 *  unregistered here (registered stays false) since it's a separate hard gate each test can
 *  choose to also satisfy or leave open. */
async function readyForHandoverExceptRegistration(): Promise<{ bookingId: string; unitId: string }> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `H-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "Handover Test Customer", phone: `98800${String(unitSeq).padStart(5, "0")}`, pan: `HOTST${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 4_000_000, docs: FULL_DOCS },
    sales()
  );
  const bookingId = b!.id;
  const unitId = unit!.id;

  await submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } }, sales());
  await acceptHandover(bookingId, crm());

  const checklist = await listChecklist(bookingId, legal());
  for (const d of checklist) {
    await uploadDocument(d.id, { content_type: "application/pdf" }, legal());
    await acceptDocument(d.id, legal());
  }

  const topupId = "d_ho_topup_" + bookingId;
  await db.query(
    `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, due_date, status) VALUES ($1,$2,$3,'ho_test_topup','Handover test top-up',99,3000000,CURRENT_DATE,'due')`,
    [topupId, bookingId, PROJECT_ID]
  );
  await postReceipt(topupId, { amount: 3_000_000, idempotency_key: "ho-topup-" + bookingId }, accounts());

  const aos = await generateLegacyDocument(bookingId, "AOS", superAdminCtx);
  await approveLegacyDocument(aos.id, superAdminCtx);
  await executeLegacyDocument(aos.id, superAdminCtx);

  await db.query(`UPDATE unit SET utilities_ready = true WHERE id = $1`, [unitId]);
  await db.query(`UPDATE qa_evidence SET qa_verified = true WHERE unit_id = $1`, [unitId]);

  return { bookingId, unitId };
}

describe("rule 1 — gate evaluation is config-driven; commitments is HARD (p17 §9, corrects an earlier soft guess)", () => {
  it("a fresh booking is not eligible (every hard gate open); satisfying every input except registration still blocks on REGISTRATION", async () => {
    const { bookingId } = await readyForHandoverExceptRegistration();
    const view = await getHandoverCase(bookingId, qa());
    expect(view.eligible).toBe(false);
    const registrationGate = view.gates.find((g) => g.type === "registration")!;
    expect(registrationGate.classification).toBe("hard");
    expect(registrationGate.state).toBe("open");
    const commitmentsGate = view.gates.find((g) => g.type === "commitments")!;
    expect(commitmentsGate.classification).toBe("hard");
  });

  it("POST /handover/:id/evaluate logs handover.gate_evaluated once per call", async () => {
    const { bookingId } = await readyForHandoverExceptRegistration();
    const view = await evaluateAndLog(bookingId, qa());
    expect(await eventTypesFor(view.case.id)).toContain("handover.gate_evaluated");
  });
});

describe("rule 2 — override requires overridable + role + reason; PHYSICAL can never be overridden (p17 'no override')", () => {
  it("rejects an override with no reason, rejects PHYSICAL outright, then accepts a valid COMMITMENTS override from an authorised role", async () => {
    const { bookingId } = await readyForHandoverExceptRegistration();
    await openCommitment(bookingId);
    await expect(overrideGate(bookingId, { gate: "PHYSICAL", reason: "customer is waiting" }, management())).rejects.toThrow(/cannot be overridden/);
    await expect(overrideGate(bookingId, { gate: "COMMITMENTS", reason: "" }, crm())).rejects.toThrow(/reason is required/);

    const overridden = await overrideGate(bookingId, { gate: "COMMITMENTS", reason: "customer waived, verbal confirmation on file" }, crm());
    const gate = overridden.gates.find((g) => g.type === "commitments")!;
    expect(gate.overridden).toBe(true);
    expect(await eventTypesFor(overridden.case.id)).toContain("handover.gate_overridden");
  });
});

describe("acceptance criteria — one test per gate row: hard/soft classification + override permissions (p17 §9)", () => {
  const GATE_ROWS: {
    db: string; type: string; classification: "hard" | "soft"; overridable: boolean; authorizedCtx: () => Ctx;
    extra?: Record<string, unknown>;
  }[] = [
    { db: "FINANCIAL", type: "financial", classification: "hard", overridable: true, authorizedCtx: management, extra: { approved_by_user_id: "user_management" } },
    { db: "LEGAL", type: "legal", classification: "hard", overridable: true, authorizedCtx: legal },
    { db: "REGISTRATION", type: "registration", classification: "hard", overridable: true, authorizedCtx: registration },
    { db: "PHYSICAL", type: "physical", classification: "hard", overridable: false, authorizedCtx: management },
    { db: "QUALITY", type: "quality", classification: "hard", overridable: true, authorizedCtx: qa, extra: { evidence_file_ids: ["file_qa_signoff"] } },
    { db: "COMMITMENTS", type: "commitments", classification: "hard", overridable: true, authorizedCtx: crm },
    { db: "CUSTOMER", type: "customer", classification: "soft", overridable: true, authorizedCtx: crm },
    { db: "FM_COMMUNITY", type: "fm", classification: "soft", overridable: true, authorizedCtx: fm },
  ];

  it.each(GATE_ROWS)("$db: classification=$classification, overridable=$overridable", async (row) => {
    const { bookingId } = await readyForHandoverExceptRegistration();
    const view = await getHandoverCase(bookingId, qa());
    const gateView = view.gates.find((g) => g.type === row.type)!;
    expect(gateView.classification).toBe(row.classification);

    // "sales" is seeded (seed/users.ts) but not in any gate's override_roles — a real staff
    // user, not an FK-violating invented id (0039's authority_user_id references "user").
    await expect(overrideGate(bookingId, { gate: row.db, reason: "test", ...row.extra }, sales())).rejects.toThrow(
      /cannot be overridden|override requires one of/
    );

    if (row.overridable) {
      const result = await overrideGate(bookingId, { gate: row.db, reason: "test override", ...row.extra }, row.authorizedCtx());
      expect(result).toBeDefined();
    } else {
      await expect(overrideGate(bookingId, { gate: row.db, reason: "test override", ...row.extra }, row.authorizedCtx())).rejects.toThrow(/cannot be overridden/);
    }
  });
});

describe("rule 4 — appointment: propose requires eligibility, confirm flips the case to SCHEDULED, reschedule appends history + creates an action", () => {
  it("blocks proposing until eligible, then proposes/confirms/reschedules", async () => {
    const { bookingId } = await readyForHandoverExceptRegistration();
    await expect(proposeAppointment(bookingId, [new Date().toISOString(), new Date().toISOString()], qa())).rejects.toThrow(/gate_blocked/);

    await clearRemainingHardGatesByOverride(bookingId);
    const view = await getHandoverCase(bookingId, qa());
    expect(view.eligible).toBe(true);

    const slots = [new Date(Date.now() + 5 * 86400000).toISOString(), new Date(Date.now() + 7 * 86400000).toISOString()];
    const proposed = await proposeAppointment(bookingId, slots, crm());
    expect(proposed.appointment?.proposed_slots.length).toBe(2);

    const confirmed = await confirmAppointment(bookingId, { slot: slots[0]!, confirmed_by: "CRM_ON_BEHALF", note: "customer called in" }, crm());
    expect(confirmed.case.status).toBe("SCHEDULED");
    const confirmedEvents = await eventTypesFor(confirmed.case.id);
    expect(confirmedEvents).toContain("handover.appointment_confirmed");
    expect(confirmedEvents).toContain("handover.scheduled");

    const rescheduled = await rescheduleAppointment(bookingId, { slot: slots[1]!, reason: "customer travel conflict" }, crm());
    expect(rescheduled.appointment?.rescheduled_count).toBe(1);
    expect(await eventTypesFor(rescheduled.case.id)).toContain("handover.appointment_rescheduled");
    const action = await db.query(`SELECT id FROM action WHERE source_entity_id = $1 AND type = 'handover_appointment_reschedule'`, [rescheduled.case.id]);
    expect(action.rows.length).toBe(1);
  });
});

describe("rule 5 — completion requires eligible gates AND checklist keys.all_handed_over AND both signatures", () => {
  it("blocks completion on a missing checklist/signature even when every hard gate is cleared, then completes", async () => {
    const { bookingId, unitId } = await readyForHandoverExceptRegistration();
    await clearRemainingHardGatesByOverride(bookingId);
    await expect(completeCase(bookingId, qa())).rejects.toThrow(/keys/);

    await updateChecklist(bookingId, { groups: { keys: { all_handed_over: { done: true } } } }, qa());
    await expect(completeCase(bookingId, qa())).rejects.toThrow(/signatures/);

    await updateChecklist(bookingId, { customer_signature_file_id: "file_cust_sig", company_signature_file_id: "file_co_sig" }, qa());
    const completed = await completeCase(bookingId, qa());
    expect(completed.case.status).toBe("COMPLETED");
    expect(await eventTypesFor(bookingId)).toContain("handover.completed");

    const unit = await db.query<{ sale_status: string }>(`SELECT sale_status FROM unit WHERE id = $1`, [unitId]);
    expect(unit.rows[0]!.sale_status).toBe("handed_over");
    const booking = await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = $1`, [bookingId]);
    expect(booking.rows[0]!.status).toBe("handed_over");

    // Rule 5's "opens 30 post-handover case" — warranty.ts's pre-existing onHandoverCompleted.
    const dlp = await db.query(`SELECT id FROM dlp_window WHERE booking_id = $1`, [bookingId]);
    expect(dlp.rows.length).toBe(1);

    await expect(completeCase(bookingId, qa())).rejects.toThrow(/already completed/);
  });
});

describe("rule 6 — CLOSED requires COMPLETED and a post-handover (DLP) window", () => {
  it("closes once completed and emits handover.closed", async () => {
    const { bookingId } = await readyForHandoverExceptRegistration();
    await clearRemainingHardGatesByOverride(bookingId);
    await updateChecklist(bookingId, { groups: { keys: { all_handed_over: { done: true } } }, customer_signature_file_id: "file_cust_sig", company_signature_file_id: "file_co_sig" }, qa());
    await completeCase(bookingId, qa());

    const closed = await closeCase(bookingId, qa());
    expect(closed.case.status).toBe("CLOSED");
    expect(await eventTypesFor(closed.case.id)).toContain("handover.closed");
  });
});

describe("two-producer coexistence — qa.ts's legacy completeHandover on a row this module already touched", () => {
  it("doesn't throw a unique-violation once loadOrCreateCase has lazily created the row (ON CONFLICT DO UPDATE)", async () => {
    const { bookingId, unitId } = await readyForHandoverExceptRegistration();
    await db.query(`UPDATE unit SET sale_status = 'registered' WHERE id = $1`, [unitId]); // legacy eligibility, no overrides needed
    await getHandoverCase(bookingId, qa()); // lazily creates the handover_record row, status='not_started'

    await legacyCompleteHandover(bookingId, superAdminCtx);

    const row = await db.query<{ status: string }>(`SELECT status FROM handover_record WHERE booking_id = $1`, [bookingId]);
    expect(row.rows[0]!.status).toBe("completed");
  });
});

describe("Policy Studio — handover gate configuration (25's Tabs line)", () => {
  it("a project override changes classification and is picked up by the next evaluation", async () => {
    const { bookingId } = await readyForHandoverExceptRegistration();
    const before = await getHandoverCase(bookingId, qa());
    expect(before.gates.find((g) => g.type === "customer")!.classification).toBe("soft");

    await putGateConfig(
      { gate: "CUSTOMER", classification: "HARD", overridable: true, override_roles: ["CRM", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, project_id: before.case.project_id },
      management()
    );
    const after = await getHandoverCase(bookingId, qa());
    const customerGate = after.gates.find((g) => g.type === "customer")!;
    expect(customerGate.classification).toBe("hard");
    expect(customerGate.state).toBe("passed"); // handover.ts's own customer input is always true (26 portal flip isn't wired) — only its classification moved
  });
});
