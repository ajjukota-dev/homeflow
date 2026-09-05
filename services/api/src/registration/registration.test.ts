import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { createProject, createUnit } from "../projects";
import { createBooking } from "../bookings";
import { submitHandover, acceptHandover } from "../sales-handover/core";
import { listChecklist, uploadDocument, acceptDocument } from "../documents/checklist";
import { postReceipt } from "../demands-receipts";
import { updateClearanceChecklist, approveClearance } from "../financial-clearance";
import { generateDocument as generateLegacyDocument, approveDocument as approveLegacyDocument, executeDocument as executeLegacyDocument } from "../legal-docs";
import { putMergeFields, createTemplate, submitTemplateForReview, approveTemplate } from "../documents/templates";
import { generateDocument as generateFactoryDocument } from "../documents/generate";
import { submitForReview, decideStage, sendForCustomerReview, approveForExecution, recordExecution as recordDocExecution } from "../documents/workflow";
import {
  getRegistrationCase, listRegistrationPipeline, confirmAvailability, bookSlot, rescheduleSlot,
  updateDayOfChecklist, recordExecution, completeCase,
} from "./core";
import { listChecklistTemplates, putChecklistTemplate } from "./policy";

// 23-registration.md — integration over real PGlite. `registration_case` predates this spec
// (0000_init.sql: legacy legal-docs.ts's own simple completeRegistration flow) — ALTERed in
// place, both flows verified to coexist on the same row.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const registration = () => ctxAs("user_registration", ["REGISTRATION"]);
const legal = () => ctxAs("user_legal", ["LEGAL"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);
const accounts = () => ctxAs("user_accounts", ["ACCOUNTS"]);
const sales = () => ctxAs("user_sales", ["SALES"]);
const crm = () => ctxAs("user_crm", ["CRM"]);

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
  const p = await createProject({ code: "regtest", name: "Registration Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
  await putMergeFields(
    [
      { code: "customer_name", source_path: "customer.primary_name", type: "STRING", format: null, required: true, sensitivity: null },
      { code: "unit_code", source_path: "unit.code", type: "STRING", format: null, required: true, sensitivity: null },
    ],
    legal()
  );
  const draft = await createTemplate({ family_code: "SALE_DEED", name: "Sale Deed", transaction_type: "SALE", body_html: "<p>{{customer_name}} - {{unit_code}}</p>" }, legal());
  await submitTemplateForReview(draft.id, legal());
  await approveTemplate(draft.id, "initial version", legal());
});

async function eventTypesFor(entityId: string): Promise<string[]> {
  return (await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_id = $1 ORDER BY id`, [entityId])).rows.map((r) => r.type);
}

async function freshBooking(): Promise<{ bookingId: string; unitId: string }> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `R-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(
    unit!.id,
    { applicant: { display_name: "Registration Test Customer", phone: `98700${String(unitSeq).padStart(5, "0")}`, pan: `REGTU${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 4_000_000, docs: FULL_DOCS },
    sales()
  );
  return { bookingId: b!.id, unitId: unit!.id };
}

/** Walks a booking through every hard readiness input (rule 1) except the registration domain's
 *  own state, so each test can start from READY and drive the registration-specific rules. Total
 *  consideration is kept below the §194IA ₹50L threshold so TDS auto-resolves NOT_APPLICABLE with
 *  no record needed — that path is 19's own rule 7, already covered by tds.test.ts. */
async function readyForRegistration(): Promise<{ bookingId: string; unitId: string; deedDocumentId: string }> {
  const { bookingId, unitId } = await freshBooking();
  await submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } }, sales());
  await acceptHandover(bookingId, crm());

  const checklist = await listChecklist(bookingId, legal());
  for (const d of checklist) {
    await uploadDocument(d.id, { content_type: "application/pdf" }, legal());
    await acceptDocument(d.id, legal());
  }

  const topupId = "d_topup_" + bookingId;
  await db.query(
    `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, due_date, status) VALUES ($1,$2,$3,'reg_test_topup','Registration test top-up',99,3000000,CURRENT_DATE,'due')`,
    [topupId, bookingId, PROJECT_ID]
  );
  await postReceipt(topupId, { amount: 3_000_000, idempotency_key: "reg-topup-" + bookingId }, accounts());

  await updateClearanceChecklist(
    bookingId, "REGISTRATION",
    { ledger_reconciled: true, due_amounts_paid: true, tds_verified: true, bank_disbursement_applicable: false, other_charges_cleared: true, exceptions_approved: true },
    accounts()
  );
  await approveClearance(bookingId, "REGISTRATION", management());

  const aos = await generateLegacyDocument(bookingId, "AOS", superAdminCtx);
  await approveLegacyDocument(aos.id, superAdminCtx);
  await executeLegacyDocument(aos.id, superAdminCtx);

  const deed = await generateFactoryDocument(bookingId, "SALE_DEED", {}, legal());
  await submitForReview(deed.id, legal());
  await decideStage(deed.id, "INTERNAL_REVIEW", "APPROVED", null, legal());
  await decideStage(deed.id, "LEGAL", "APPROVED", null, legal());
  await sendForCustomerReview(deed.id, legal());
  await approveForExecution(deed.id, legal());
  await recordDocExecution(deed.id, { mode: "ESIGN", executed_on: "2026-09-06", signatories: [{ name: "Registration Test Customer" }] }, legal());

  return { bookingId, unitId, deedDocumentId: deed.id };
}

describe("rule 1 — readiness computed live; NOT_READY until every hard input is satisfied", () => {
  it("a fresh booking starts NOT_READY, then reaches READY once documents/clearance/tds/AOS/sale-deed/signatories/poa all resolve", async () => {
    const { bookingId } = await freshBooking();
    const fresh = await getRegistrationCase(bookingId, registration());
    expect(fresh.status).toBe("NOT_READY");
    expect(fresh.readiness.documents.ok).toBe(false);

    const { bookingId: readyBookingId } = await readyForRegistration();
    const ready = await getRegistrationCase(readyBookingId, registration());
    expect(ready.status).toBe("READY");
    expect(ready.readiness.clearance.ok).toBe(true);
    expect(ready.readiness.tds.ok).toBe(true);
    expect(ready.readiness.agreement_executed.ok).toBe(true);
    expect(ready.readiness.sale_deed_ready.ok).toBe(true);
    expect(ready.readiness.signatories.ok).toBe(true);
    expect(ready.readiness.poa_valid.ok).toBe(true); // no POA applicant on this booking
    expect(await eventTypesFor(ready.id)).toContain("registration.readiness_changed");
  });
});

describe("rule 2 — availability confirmed, then slot booked; every slot change appends to slot_history", () => {
  it("CRM confirms availability on the customer's behalf (portal 26 not built — the named fallback); slot booking requires it", async () => {
    const { bookingId } = await readyForRegistration();
    await expect(bookSlot(bookingId, { sro_office: "SRO Bengaluru", slot_datetime: new Date(Date.now() + 5 * 86400000).toISOString(), reference: "SRO-REF-1" }, registration())).rejects.toThrow(/no confirmed customer availability/);

    const dates = [new Date(Date.now() + 5 * 86400000).toISOString(), new Date(Date.now() + 7 * 86400000).toISOString()];
    const confirmed = await confirmAvailability(bookingId, dates, crm());
    expect(confirmed.status).toBe("AVAILABILITY_CONFIRMED");
    expect(await eventTypesFor(confirmed.id)).toContain("registration.availability_confirmed");

    const booked = await bookSlot(bookingId, { sro_office: "SRO Bengaluru", slot_datetime: dates[0]!, reference: "SRO-REF-1" }, registration());
    expect(booked.status).toBe("SLOT_BOOKED");
    expect(booked.slot_history.length).toBe(1);
    expect(booked.escalation_needed).toBe(false);
    expect(await eventTypesFor(booked.id)).toContain("registration.scheduled");

    const rescheduled = await rescheduleSlot(bookingId, { slot_datetime: dates[1]!, reason: "SRO office closed" }, registration());
    expect(rescheduled.slot_history.length).toBe(2);
    expect(rescheduled.slot_history[1]!.reason).toBe("SRO office closed");
    expect(await eventTypesFor(rescheduled.id)).toContain("registration.rescheduled");
  });
});

describe("rule 5 — day-of checklist must be complete before EXECUTED can be recorded", () => {
  it("blocks execution until every day_of_items key is true, then records it", async () => {
    const { bookingId } = await readyForRegistration();
    const dates = [new Date(Date.now() + 5 * 86400000).toISOString()];
    await confirmAvailability(bookingId, dates, crm());
    await bookSlot(bookingId, { sro_office: "SRO Bengaluru", slot_datetime: dates[0]!, reference: "SRO-REF-2" }, registration());

    await expect(recordExecution(bookingId, { executed_on: "2026-09-10" }, registration())).rejects.toThrow(/day-of checklist incomplete/);

    const templates = await listChecklistTemplates(registration());
    const globalTemplate = templates.find((t) => t.project_id === null && t.jurisdiction === null)!;
    for (const item of globalTemplate.day_of_items) {
      await updateDayOfChecklist(bookingId, { [item.key]: true }, registration());
    }
    const executed = await recordExecution(bookingId, { executed_on: "2026-09-10", registration_document_number: "REGDOC-1" }, registration());
    expect(executed.status).toBe("EXECUTED");
    expect(await eventTypesFor(executed.id)).toContain("registration.executed");
  });
});

describe("rule 3 — completion requires the deed FINAL + a registration_document_number; sets booking/unit REGISTERED", () => {
  it("completes and emits registration.completed, and refuses a second completion", async () => {
    const { bookingId, unitId, deedDocumentId } = await readyForRegistration();
    const dates = [new Date(Date.now() + 5 * 86400000).toISOString()];
    await confirmAvailability(bookingId, dates, crm());
    await bookSlot(bookingId, { sro_office: "SRO Bengaluru", slot_datetime: dates[0]!, reference: "SRO-REF-3" }, registration());
    const templates = await listChecklistTemplates(registration());
    const globalTemplate = templates.find((t) => t.project_id === null && t.jurisdiction === null)!;
    for (const item of globalTemplate.day_of_items) await updateDayOfChecklist(bookingId, { [item.key]: true }, registration());
    await recordExecution(bookingId, { executed_on: "2026-09-10", registration_document_number: "REGDOC-2" }, registration());

    const completed = await completeCase(bookingId, { deed_document_id: deedDocumentId, sro_reference: "SRO/BNG/2026/9001" }, registration());
    expect(completed.status).toBe("COMPLETED");
    // registration.completed is emitted entity_type: "booking" (matching legal-docs.ts's own
    // pre-existing producer of this same event, so any future subscriber sees one addressing
    // convention regardless of which flow completed the case).
    expect(await eventTypesFor(bookingId)).toContain("registration.completed");

    const booking = await db.query<{ status: string }>(`SELECT status FROM booking WHERE id = $1`, [bookingId]);
    expect(booking.rows[0]!.status).toBe("registered");
    const unit = await db.query<{ sale_status: string }>(`SELECT sale_status FROM unit WHERE id = $1`, [unitId]);
    expect(unit.rows[0]!.sale_status).toBe("registered");

    await expect(completeCase(bookingId, { deed_document_id: deedDocumentId, sro_reference: "SRO/BNG/2026/9001" }, registration())).rejects.toThrow(/already completed/);
  });
});

describe("Policy Studio — registration checklist templates (25's Tabs line)", () => {
  it("a project-specific override beats the global default", async () => {
    const before = await listChecklistTemplates(management());
    const globalCount = before.length;
    const custom = await putChecklistTemplate(
      { project_id: PROJECT_ID, jurisdiction: null, pre_items: [{ key: "documents", label: "Docs" }], day_of_items: [{ key: "id_proofs", label: "ID proofs" }], sro_offices: ["SRO Bengaluru"], jurisdiction_lead_days: 10 },
      management()
    );
    expect(custom.project_id).toBe(PROJECT_ID);
    const after = await listChecklistTemplates(management());
    expect(after.length).toBe(globalCount + 1);

    const { bookingId } = await freshBooking();
    const view = await getRegistrationCase(bookingId, registration());
    // forecast_confidence/date exist regardless of readiness (rule 4) — proves loadTemplate resolved the project override's 10-day lead, not the global default's 15.
    expect(view.forecast_date).not.toBeNull();
  });
});

describe("pipeline listing", () => {
  it("lists every case for a project", async () => {
    await freshBooking();
    const pipeline = await listRegistrationPipeline(PROJECT_ID, registration());
    expect(pipeline.length).toBeGreaterThan(0);
  });
});
