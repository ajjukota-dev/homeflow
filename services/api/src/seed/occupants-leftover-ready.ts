import { db } from "../db";
import { listChecklist, uploadDocument, acceptDocument } from "../documents/checklist";
import { postReceipt } from "../demands-receipts";
import { listDemands } from "../demands";
import { updateClearanceChecklist, approveClearance } from "../financial-clearance";
import { upsertTdsRecord, verifyTds, suggestTdsApplicability } from "../tds";
import { createTemplate, submitTemplateForReview, approveTemplate } from "../documents/templates";
import { executeAos } from "./occupants-papers";
import { accounts, legal, management } from "./occupants-ctx";
import { nextCode } from "../model/codes";

// Shared readiness steps for leftover registration/handover. SALE_DEED factory generate
// calls pdf.render (Chromium) — seed() runs inside every vitest initDb, so we insert one
// APPROVED_FOR_EXECUTION factory row after approving a template, matching Day 2 skipping
// issueQuotation for the same reason.

export async function acceptAllDocs(bookingId: string): Promise<void> {
  const checklist = await listChecklist(bookingId, legal);
  for (const d of checklist) {
    if (d.status === "ACCEPTED") continue;
    await uploadDocument(d.id, { content_type: "application/pdf" }, legal);
    await acceptDocument(d.id, legal);
  }
}

/** Pay every demand except the last (possession) so paid_pct reaches 80% ≥ registration 70%. */
export async function payThroughFlooring(bookingId: string): Promise<void> {
  const demands = await listDemands(bookingId, db, accounts);
  const payable = demands.filter((d) => d.remaining > 0 && d.sequence < 5);
  for (const d of payable) {
    await postReceipt(d.id, { amount: d.remaining, mode: "neft", idempotency_key: `seed-leftover-${d.id}` }, accounts);
  }
}

export async function verifyTdsIfApplicable(bookingId: string): Promise<void> {
  const suggestion = await suggestTdsApplicability(bookingId);
  if (suggestion.suggested === "NOT_APPLICABLE") {
    await upsertTdsRecord(
      bookingId,
      { applicability: "NOT_APPLICABLE", na_reason: suggestion.reason },
      accounts
    );
    return;
  }
  const rec = await upsertTdsRecord(
    bookingId,
    { applicability: "APPLICABLE", amount: suggestion.suggested_amount },
    accounts
  );
  await verifyTds(
    rec.id,
    { challan_number: `CHL-${bookingId}`, challan_date: "2026-09-01", pan: "AAAAA0000A", file_id: `file_tds_${bookingId}` },
    accounts
  );
}

export async function approveRegistrationClearance(bookingId: string): Promise<void> {
  await updateClearanceChecklist(
    bookingId,
    "REGISTRATION",
    {
      ledger_reconciled: true,
      due_amounts_paid: true,
      tds_verified: true,
      bank_disbursement_applicable: false,
      other_charges_cleared: true,
      exceptions_approved: true,
    },
    accounts
  );
  await approveClearance(bookingId, "REGISTRATION", management);
}

export async function executeAosIfMissing(bookingId: string): Promise<void> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM generated_document WHERE booking_id = $1 AND document_family = 'AOS' AND status IN ('executed','archived')`,
    [bookingId]
  );
  if (existing.rows[0]) return;
  await executeAos(bookingId);
}

async function ensureSaleDeedTemplate(): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM doc_factory_template WHERE family_code = 'SALE_DEED' AND status = 'APPROVED' LIMIT 1`
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const draft = await createTemplate(
    { family_code: "SALE_DEED", name: "Sale Deed", transaction_type: "SALE", body_html: "<p>Sale deed</p>" },
    legal
  );
  await submitTemplateForReview(draft.id, legal);
  await approveTemplate(draft.id, "leftover seed: factory template so registration readiness can see a SALE_DEED", legal);
  return draft.id;
}

/** Inserts an APPROVED_FOR_EXECUTION SALE_DEED without Chromium (generateDocument → pdf.render). */
export async function markSaleDeedReady(bookingId: string): Promise<void> {
  const have = await db.query<{ id: string }>(
    `SELECT id FROM doc_factory_document WHERE booking_id = $1 AND family_code = 'SALE_DEED'
       AND status IN ('APPROVED_FOR_EXECUTION','EXECUTED','FINAL','ARCHIVED') LIMIT 1`,
    [bookingId]
  );
  if (have.rows[0]) return;
  const templateId = await ensureSaleDeedTemplate();
  const b = await db.query<{ project_id: string; unit_id: string; customer_id: string | null }>(
    `SELECT b.project_id, b.unit_id, ba.customer_id FROM booking b
       LEFT JOIN booking_applicant ba ON ba.booking_id = b.id AND ba.role = 'primary'
      WHERE b.id = $1`,
    [bookingId]
  );
  const code = await nextCode(db, "DOC");
  await db.query(
    `INSERT INTO doc_factory_document
       (id, code, family_code, template_id, booking_id, unit_id, customer_id, project_id, status, version)
     VALUES ($1,$2,'SALE_DEED',$3,$4,$5,$6,$7,'APPROVED_FOR_EXECUTION',1)`,
    [
      "gdoc_seed_" + bookingId,
      code,
      templateId,
      bookingId,
      b.rows[0]!.unit_id,
      b.rows[0]!.customer_id,
      b.rows[0]!.project_id,
    ]
  );
}

export async function readyForRegistrationSlot(bookingId: string): Promise<void> {
  await acceptAllDocs(bookingId);
  await payThroughFlooring(bookingId);
  await verifyTdsIfApplicable(bookingId);
  await executeAosIfMissing(bookingId);
  await approveRegistrationClearance(bookingId);
  await markSaleDeedReady(bookingId);
}
