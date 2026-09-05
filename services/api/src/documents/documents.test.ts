import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { createProject, createUnit } from "../projects";
import { createBooking } from "../bookings";
import { submitHandover, acceptHandover } from "../sales-handover/core";
import { createTemplate, submitTemplateForReview, approveTemplate, listMergeFields, putMergeFields } from "./templates";
import { createClause, approveClause, putSelectionRules } from "./clauses";
import { computeReadiness } from "./readiness";
import { generateDocument } from "./generate";
import { submitForReview, decideStage, sendForCustomerReview, approveForExecution, recordExecution, archiveDocument } from "./workflow";
import { raiseDeviation, approveDeviation } from "./deviations";
import { listChecklist, requestDocument, uploadDocument, acceptDocument, rejectDocument, allRequiredAccepted } from "./checklist";
import { moneyToIndianWords, moneyToIndianFigures, resolvePath } from "./source";

// 22-document-factory.md — integration over real PGlite (`document_template`/`generated_document`
// and legal-docs.ts's AOS flow are untouched; this factory's own tables are doc_factory_*). One
// test per rule; rule 9's Indian-number-formatting half is covered as a pure test alongside it.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const legal = () => ctxAs("user_legal", ["LEGAL"]);
const legal2 = () => ctxAs("user_legal2", ["LEGAL"]);
const management = () => ctxAs("user_management", ["MANAGEMENT"]);
const site = () => ctxAs("user_site", ["SITE"]);
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
  const p = await createProject({ code: "doctest", name: "Document Factory Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
  await db.query(
    `INSERT INTO project_team_assignment (id, project_id, user_id, department, role_scope, assignment_type, is_primary_owner, effective_from)
     VALUES ('pta_doctest_crm', $1, 'user_crm', 'CRM', 'CRM', 'DEDICATED', true, '2020-01-01')`,
    [PROJECT_ID]
  );
  // Rule 1/2/3/9 fixtures: a real merge field + a clause of each type + a template referencing both.
  await putMergeFields(
    [
      { code: "customer_name", source_path: "customer.primary_name", type: "STRING", format: null, required: true, sensitivity: null },
      { code: "unit_code", source_path: "unit.code", type: "STRING", format: null, required: true, sensitivity: null },
      { code: "consideration_words", source_path: "booking.total_consideration", type: "MONEY", format: "WORDS", required: true, sensitivity: null },
    ],
    legal()
  );
  const locked = await createClause({ code: "STD_PAYMENT", title: "Standard payment terms", body_html: "Payment terms are fixed per the schedule.", type: "LOCKED" }, legal());
  await approveClause(locked.id, legal());
  const negotiable = await createClause({ code: "SPECIAL_TERM", title: "Special term", body_html: "No special terms apply.", type: "NEGOTIABLE_WITH_APPROVAL" }, legal());
  await approveClause(negotiable.id, legal());

  const draft = await createTemplate(
    { family_code: "ALLOTMENT_LETTER", name: "Allotment letter", transaction_type: "LETTER", body_html: "<p>Dear {{customer_name}}, unit {{unit_code}} is allotted for {{consideration_words}}.</p>{{clause:STD_PAYMENT}}{{clause:SPECIAL_TERM}}" },
    legal()
  );
  await submitTemplateForReview(draft.id, legal());
  await approveTemplate(draft.id, "initial version", legal());
  await putSelectionRules(draft.id, [{ clause_code: "STD_PAYMENT" }, { clause_code: "SPECIAL_TERM" }], legal());
});

async function freshBooking(): Promise<string> {
  unitSeq += 1;
  const unit = await createUnit(PROJECT_ID, { unit_number: `D-${unitSeq}`, unit_type: "2BHK", facing: "East" }, superAdminCtx);
  const b = await createBooking(unit!.id, { applicant: { display_name: "Document Test Customer", phone: `9776600${String(unitSeq).padStart(3, "0")}`, pan: `DOCTU${String(unitSeq).padStart(4, "0")}A` }, total_consideration: 8_000_000, docs: FULL_DOCS }, sales());
  return b!.id;
}

/** Real 17 accept flow — fires sales_handover.accepted (rule 8's real trigger) and sets customer_id. */
async function acceptedBooking(): Promise<string> {
  const bookingId = await freshBooking();
  await submitHandover(bookingId, { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" } }, sales());
  await acceptHandover(bookingId, crm());
  return bookingId;
}

async function eventTypesFor(entityId: string): Promise<string[]> {
  return (await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_id = $1 ORDER BY id`, [entityId])).rows.map((r) => r.type);
}

describe("rule 9 (pure) — Indian number formatting: full figures, no Cr/L abbreviations", () => {
  it("moneyToIndianWords/Figures group correctly and resolvePath walks dotted/bracket paths", () => {
    expect(moneyToIndianWords(12_000_000)).toBe("One Crore Twenty Lakh Rupees Only");
    expect(moneyToIndianFigures(12_000_000)).toBe("₹1,20,00,000");
    expect(moneyToIndianWords(0)).toBe("Zero Rupees Only");
    expect(resolvePath({ applicant: [{ pan: "ABCDE1234F" }] }, "applicant[0].pan")).toBe("ABCDE1234F");
    expect(resolvePath({ unit: { code: "U-1" } }, "unit.missing")).toBeUndefined();
  });
});

describe("rule 1 — generate only from an APPROVED template valid for the scope", () => {
  it("blocks when no APPROVED template exists for the family, then succeeds once one is approved", async () => {
    const bookingId = await acceptedBooking();
    await expect(generateDocument(bookingId, "NOC", {}, legal())).rejects.toThrow(/no APPROVED template/);
    const doc = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    expect(doc.status).toBe("DRAFT");
    expect(doc.version).toBe(1);
    expect(doc.pdf_file_key).toMatch(/\.pdf$/);
    expect(doc.checksum).toBeTruthy();
    expect(await eventTypesFor(doc.id)).toContain("document.generated");
    // rule 10: the beforeAll fixtures' own approvals fired their events.
    const templateEvents = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'doc_factory_template'`);
    expect(templateEvents.rows.map((r) => r.type)).toContain("template.version_approved");
    const clauseEvents = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'clause'`);
    expect(clauseEvents.rows.map((r) => r.type)).toContain("clause.version_approved");
  }, 20_000);
});

describe("rule 2 — readiness panel: Ready/Warning/Blocked with named facts", () => {
  it("blocks on a missing required merge field and reports the Sale Deed completeness facts", async () => {
    const bookingId = await acceptedBooking();
    const readiness = await computeReadiness(bookingId, "ALLOTMENT_LETTER", db);
    expect(readiness.result).toBe("READY");

    // A template with a merge field that resolves to nothing (no such column) is BLOCKED.
    await putMergeFields([{ code: "nonexistent_field", source_path: "unit.does_not_exist", type: "STRING", format: null, required: true, sensitivity: null }], legal());
    const brokenDraft = await createTemplate({ family_code: "NOC", name: "NOC", transaction_type: "LETTER", body_html: "<p>{{nonexistent_field}}</p>" }, legal());
    await submitTemplateForReview(brokenDraft.id, legal());
    await approveTemplate(brokenDraft.id, null, legal());
    const blocked = await computeReadiness(bookingId, "NOC", db);
    expect(blocked.result).toBe("BLOCKED");
    expect(blocked.facts[0]!.message).toMatch(/nonexistent_field/);

    // Sale Deed's named completeness checks (no clearance/AOS/KYC yet -> at least one BLOCKED, one WARNING).
    const saleDeedDraft = await createTemplate({ family_code: "SALE_DEED", name: "Sale Deed", transaction_type: "SALE", body_html: "<p>{{customer_name}}</p>" }, legal());
    await submitTemplateForReview(saleDeedDraft.id, legal());
    await approveTemplate(saleDeedDraft.id, null, legal());
    const saleDeedReadiness = await computeReadiness(bookingId, "SALE_DEED", db);
    expect(saleDeedReadiness.result).toBe("BLOCKED");
    expect(saleDeedReadiness.facts.some((f) => f.message.includes("Agreement of Sale"))).toBe(true);
  });
});

describe("rule 3 — data_snapshot frozen; regenerating creates version+1, a redline, and supersedes the previous", () => {
  it("computes fields_changed on the consideration change and marks v1 SUPERSEDED", async () => {
    const bookingId = await acceptedBooking();
    const v1 = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    expect(v1.data_snapshot.consideration_words).toBe("Eighty Lakh Rupees Only");

    await db.query(`UPDATE booking SET total_consideration = 9000000 WHERE id = $1`, [bookingId]);
    const v2 = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    expect(v2.version).toBe(2);
    expect(v2.redline_summary!.fields_changed).toContain("consideration_words");

    const v1Reloaded = await db.query<{ status: string; superseded_by_id: string }>(`SELECT status, superseded_by_id FROM doc_factory_document WHERE id = $1`, [v1.id]);
    expect(v1Reloaded.rows[0]!.status).toBe("SUPERSEDED");
    expect(v1Reloaded.rows[0]!.superseded_by_id).toBe(v2.id);
    expect(await eventTypesFor(v2.id)).toContain("document.version_created");
    // 30s not 20s: 18 (change-requests.test.ts) added its own pdf.render() calls to the full
    // suite, and this test already ran two generations under the old threshold's headroom.
  }, 30_000);
});

describe("rule 4 — draft watermark until APPROVED_FOR_EXECUTION", () => {
  it("is watermarked through customer review and un-watermarked once approved for execution", async () => {
    const bookingId = await acceptedBooking();
    const doc = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    expect(doc.is_draft_watermarked).toBe(true);
    let d = await submitForReview(doc.id, legal());
    d = await decideStage(doc.id, "INTERNAL_REVIEW", "APPROVED", null, legal());
    d = await decideStage(doc.id, "LEGAL", "APPROVED", null, legal());
    d = await sendForCustomerReview(doc.id, legal());
    expect(d.is_draft_watermarked).toBe(true);
    d = await approveForExecution(doc.id, legal());
    expect(d.is_draft_watermarked).toBe(false);
    expect(await eventTypesFor(doc.id)).toEqual(expect.arrayContaining(["document.customer_review_sent", "document.approved_for_execution"]));
  }, 20_000);
});

describe("rule 5 — LOCKED clauses reject parameters; a NEGOTIABLE_WITH_APPROVAL deviation needs Legal approval, never the raiser, and applies on regeneration", () => {
  it("rejects a LOCKED clause_param, then raises/approves a deviation that changes the next generated version's clause text", async () => {
    const bookingId = await acceptedBooking();
    await expect(generateDocument(bookingId, "ALLOTMENT_LETTER", { clause_params: { STD_PAYMENT: { note: "x" } } }, legal())).rejects.toThrow(/LOCKED/);

    const v1 = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    const dev = await raiseDeviation(v1.id, { clause_code: "SPECIAL_TERM", proposed: "A 6-month price protection applies.", reason: "Customer negotiated price protection" }, legal());
    await expect(approveDeviation(dev.id, legal())).rejects.toThrow(/raiser cannot approve/);

    const approved = await approveDeviation(dev.id, legal2());
    expect(approved.status).toBe("APPROVED");
    expect(await eventTypesFor(dev.id)).toEqual(expect.arrayContaining(["document.deviation_raised", "document.deviation_approved"]));
    const v2 = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    expect(v2.selected_clauses.find((c) => c.code === "SPECIAL_TERM")!.body_html).toBe("A 6-month price protection applies.");
  }, 30_000);
});

describe("rule 6 — workflow transitions are role-gated (Legal writes; Management for commercial when money terms deviate)", () => {
  it("a non-Legal role is forbidden from submitting for review; commercial approval is required only once a deviation is approved", async () => {
    const bookingId = await acceptedBooking();
    const doc = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    await expect(submitForReview(doc.id, site())).rejects.toThrow(/forbidden|requires/);

    await submitForReview(doc.id, legal());
    await decideStage(doc.id, "INTERNAL_REVIEW", "APPROVED", null, legal());
    await decideStage(doc.id, "LEGAL", "APPROVED", null, legal());
    await expect(sendForCustomerReview(doc.id, legal())).resolves.toMatchObject({ status: "CUSTOMER_REVIEW" }); // no deviation approved yet -> commercial not required

    const doc2 = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    const dev = await raiseDeviation(doc2.id, { clause_code: "SPECIAL_TERM", proposed: "Extended warranty included.", reason: "Negotiated extra" }, legal());
    await approveDeviation(dev.id, legal2());
    const doc3 = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    await submitForReview(doc3.id, legal());
    await decideStage(doc3.id, "INTERNAL_REVIEW", "APPROVED", null, legal());
    await decideStage(doc3.id, "LEGAL", "APPROVED", null, legal());
    await expect(sendForCustomerReview(doc3.id, legal())).rejects.toThrow(/commercial approval/);
    await expect(decideStage(doc3.id, "COMMERCIAL", "APPROVED", null, legal())).rejects.toThrow(); // Legal isn't Management
    await decideStage(doc3.id, "COMMERCIAL", "APPROVED", null, management());
    await expect(sendForCustomerReview(doc3.id, legal())).resolves.toMatchObject({ status: "CUSTOMER_REVIEW" });

    // A reject at any stage lands the document in REJECTED (a distinct event name from the
    // checklist family's own "document.rejected" — see workflow.ts's header comment).
    const doc4 = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    await submitForReview(doc4.id, legal());
    const rejected = await decideStage(doc4.id, "INTERNAL_REVIEW", "REJECTED", "not ready", legal());
    expect(rejected.status).toBe("REJECTED");
    expect(await eventTypesFor(doc4.id)).toContain("document.review_rejected");
  }, 40_000);
});

describe("rule 7 — execution: REGISTRATION mode requires an SRO reference; the document auto-finalises on execution", () => {
  it("rejects a REGISTRATION execution with no sro_reference, then executes and finalises on ESIGN", async () => {
    const bookingId = await acceptedBooking();
    const doc = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    await submitForReview(doc.id, legal());
    await decideStage(doc.id, "INTERNAL_REVIEW", "APPROVED", null, legal());
    await decideStage(doc.id, "LEGAL", "APPROVED", null, legal());
    await sendForCustomerReview(doc.id, legal());
    await approveForExecution(doc.id, legal());
    await expect(recordExecution(doc.id, { mode: "REGISTRATION", executed_on: "2026-09-06" }, legal())).rejects.toThrow(/sro_reference/);

    const executed = await recordExecution(doc.id, { mode: "ESIGN", executed_on: "2026-09-06", signatories: [{ name: "Document Test Customer" }] }, legal());
    expect(executed.status).toBe("FINAL");
    const events = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'doc_factory_document' AND entity_id = $1 ORDER BY id`, [doc.id]);
    expect(events.rows.map((r) => r.type)).toEqual(expect.arrayContaining(["document.executed", "document.finalised"]));

    const archived = await archiveDocument(doc.id, legal());
    expect(archived.status).toBe("ARCHIVED");
    expect(await eventTypesFor(doc.id)).toContain("document.archived");
  }, 20_000);
});

describe("rule 8 — the customer document checklist is seeded on CRM acceptance; upload/verify never silently reverts", () => {
  it("seeds from document_checklist_rule, requests one, uploads, accepts, and re-upload after ACCEPTED re-enters VALIDATING", async () => {
    const bookingId = await acceptedBooking();
    const checklist = await listChecklist(bookingId, legal());
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist.every((d) => d.status === "REQUIRED")).toBe(true);
    expect(await allRequiredAccepted(bookingId, db)).toBe(false);

    const pan = checklist.find((d) => d.category === "PAN")!;
    await requestDocument(pan.id, legal());
    const action = await db.query<{ id: string }>(`SELECT id FROM action WHERE source_entity_id = $1 AND source_module = 'documents'`, [pan.id]);
    expect(action.rows.length).toBe(1);
    expect(await eventTypesFor(pan.id)).toContain("document.requested");

    const uploaded = await uploadDocument(pan.id, { content_type: "application/pdf" }, legal());
    expect(uploaded.document.status).toBe("VALIDATING");
    const accepted = await acceptDocument(pan.id, legal());
    expect(accepted.status).toBe("ACCEPTED");
    expect(await eventTypesFor(pan.id)).toContain("document.validated");

    const reUploaded = await uploadDocument(pan.id, { content_type: "application/pdf" }, legal());
    expect(reUploaded.document.status).toBe("VALIDATING");
    expect(reUploaded.document.file_keys.length).toBe(2);
    const reUploadEvent = await db.query<{ payload: { re_upload: boolean } }>(`SELECT payload FROM event WHERE type = 'document.received' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [pan.id]);
    expect(reUploadEvent.rows[0]!.payload.re_upload).toBe(true);

    const identityProof = checklist.find((d) => d.category === "IDENTITY_PROOF")!;
    await uploadDocument(identityProof.id, { content_type: "application/pdf" }, legal());
    const rejected = await rejectDocument(identityProof.id, "photo is illegible", legal());
    expect(rejected.status).toBe("REJECTED");
    expect(await eventTypesFor(identityProof.id)).toContain("document.rejected");
  }, 20_000);
});

describe("rule 10 — templates and clauses are versioned with approval; editing a new draft never touches an already-generated document", () => {
  it("a document generated from v1 keeps its frozen body even after v2 of the template is approved", async () => {
    const bookingId = await acceptedBooking();
    const v1Doc = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    const originalText = v1Doc.data_snapshot.consideration_words;

    const templateV2 = await createTemplate({ family_code: "ALLOTMENT_LETTER", name: "Allotment letter v2", transaction_type: "LETTER", body_html: "<p>REVISED: Dear {{customer_name}}, {{unit_code}}, {{consideration_words}}.</p>{{clause:STD_PAYMENT}}" }, legal());
    await submitTemplateForReview(templateV2.id, legal());
    await approveTemplate(templateV2.id, "revised wording", legal());
    await putSelectionRules(templateV2.id, [{ clause_code: "STD_PAYMENT" }], legal());

    const reloaded = await db.query<{ data_snapshot: { consideration_words: string } }>(`SELECT data_snapshot FROM doc_factory_document WHERE id = $1`, [v1Doc.id]);
    expect(reloaded.rows[0]!.data_snapshot.consideration_words).toBe(originalText);

    const v2Doc = await generateDocument(bookingId, "ALLOTMENT_LETTER", {}, legal());
    expect(v2Doc.template_id).toBe(templateV2.id);
  }, 25_000);
});
