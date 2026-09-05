import { db } from "../db";
import type { Ctx } from "../authz/types";
import type { DbLike } from "../events";
import { allRequiredAccepted } from "../documents/checklist";
import { getClearance } from "../financial-clearance";
import { suggestTdsApplicability } from "../tds";
import type { Readiness, ReadinessFact, RegCaseRow } from "./store";

/** Rule 1: readiness computed live from 22/19/04 facts, never trusted from a stale stored value.
 *  `sale_deed_ready` is a real addition to the Data table's 7 named keys — rule 1's own prose
 *  names "22 Sale Deed APPROVED_FOR_EXECUTION" as a distinct hard input with no jsonb key of its
 *  own in the Data table, an omission fixed here (same class as 18's added columns). The 3 keys
 *  rule 1 marks "(hard)" — clearance, tds, agreement_executed — plus documents/sale_deed_ready/
 *  signatories/poa_valid all gate READY; `customer_availability` does not (rule 2 treats it as a
 *  separate, later track: "SLOT_BOOKED requires READY + confirmed availability").
 */
export async function computeReadiness(row: RegCaseRow, ctx: Ctx, tx: DbLike = db): Promise<Readiness> {
  const bookingId = row.booking_id;

  // allRequiredAccepted reads "zero customer_document rows" as vacuously true (22's own
  // checklist is seeded lazily on sales_handover.accepted) — real bug caught by this file's own
  // test: a booking that hasn't even reached CRM acceptance must not read as documents-ready.
  const docCount = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM customer_document WHERE booking_id = $1`, [bookingId]);
  const documents = (docCount.rows[0]?.n ?? 0) > 0 && (await allRequiredAccepted(bookingId, tx));

  let clearance: ReadinessFact;
  try {
    const c = await getClearance(bookingId, "REGISTRATION", ctx);
    clearance = { ok: c.status === "APPROVED", fact: c.status === "APPROVED" ? "clearance approved" : `clearance ${c.status.toLowerCase()}${c.blocked_reasons.length ? ": " + c.blocked_reasons.join(", ") : ""}` };
  } catch {
    clearance = { ok: false, fact: "clearance not yet requested" };
  }

  const tdsRows = await tx.query<{ status: string }>(`SELECT status FROM tds_record WHERE booking_id = $1`, [bookingId]);
  let tds: ReadinessFact;
  if (tdsRows.rows.length === 0) {
    const suggestion = await suggestTdsApplicability(bookingId);
    tds = suggestion.suggested === "NOT_APPLICABLE"
      ? { ok: true, fact: "below §194IA threshold, no TDS record needed" }
      : { ok: false, fact: "TDS record required, none created yet" };
  } else {
    const bad = tdsRows.rows.filter((r) => r.status !== "VERIFIED" && r.status !== "NOT_REQUIRED");
    tds = { ok: bad.length === 0, fact: bad.length === 0 ? "TDS verified / not required" : `${bad.length} TDS record(s) pending/rejected` };
  }

  const aos = await tx.query<{ id: string }>(
    `SELECT id FROM generated_document WHERE booking_id = $1 AND document_family = 'AOS' AND status IN ('executed','archived') LIMIT 1`,
    [bookingId]
  );
  const agreement_executed: ReadinessFact = { ok: aos.rows.length > 0, fact: aos.rows.length > 0 ? "AOS executed" : "AOS not yet executed" };

  const deed = await tx.query<{ status: string }>(
    `SELECT status FROM doc_factory_document WHERE booking_id = $1 AND family_code = 'SALE_DEED' AND status IN ('APPROVED_FOR_EXECUTION','EXECUTED','FINAL','ARCHIVED') ORDER BY version DESC LIMIT 1`,
    [bookingId]
  );
  const sale_deed_ready: ReadinessFact = { ok: deed.rows.length > 0, fact: deed.rows.length > 0 ? `sale deed ${deed.rows[0]!.status.toLowerCase()}` : "sale deed not yet approved for execution" };

  const applicants = await tx.query<{ role: string; kyc_status: string | null }>(
    `SELECT ba.role, c.kyc_status FROM booking_applicant ba LEFT JOIN customer c ON c.id = ba.customer_id WHERE ba.booking_id = $1`,
    [bookingId]
  );
  // Judgment call, same class as 15/18's vocabulary-mapping calls: "signatories complete" has no
  // dedicated field on booking_applicant, so it's read off the linked customer's own KYC state.
  const relevant = applicants.rows.filter((a) => a.role.toUpperCase() !== "NOMINEE");
  const signatories: ReadinessFact = {
    ok: relevant.length > 0 && relevant.every((a) => a.kyc_status === "verified"),
    fact: relevant.length === 0 ? "no applicants on this booking" : relevant.every((a) => a.kyc_status === "verified") ? "all applicants KYC-verified" : "one or more applicants not KYC-verified",
  };

  const hasPoa = applicants.rows.some((a) => a.role.toUpperCase() === "POA");
  let poa_valid: ReadinessFact;
  if (!hasPoa) {
    poa_valid = { ok: true, fact: "no POA applicant on this booking" };
  } else {
    const doc = await tx.query<{ status: string }>(`SELECT status FROM customer_document WHERE booking_id = $1 AND category = 'POA' ORDER BY id DESC LIMIT 1`, [bookingId]);
    poa_valid = { ok: doc.rows[0]?.status === "ACCEPTED", fact: doc.rows[0]?.status === "ACCEPTED" ? "POA document accepted" : "POA document not yet accepted" };
  }

  const dates = row.proposed_availability_dates ?? [];
  const customer_availability: ReadinessFact = { ok: dates.length > 0, fact: dates.length > 0 ? `${dates.length} date(s) proposed` : "no availability proposed yet" };

  return { documents: { ok: documents, fact: documents ? "all required documents accepted" : "one or more required documents not accepted" }, clearance, tds, agreement_executed, sale_deed_ready, customer_availability, signatories, poa_valid };
}

export function allHardOk(r: Readiness): boolean {
  return r.documents.ok && r.clearance.ok && r.tds.ok && r.agreement_executed.ok && r.sale_deed_ready.ok && r.signatories.ok && r.poa_valid.ok;
}
