// 26-customer-portal.md — every function here is a customer-safe PROJECTION (rule 2), never a
// passthrough of an internal row. Each area authorizes against its own seeded `customer_*`
// permission_matrix module (seed/permissions.ts's CUSTOMER_MODULES — pre-existing, anticipating
// this exact spec) rather than the staff modules the same tables' own owning-spec code checks
// (e.g. "commitments" vs "customer_commitments") — a customer ctx could never pass the staff
// check anyway, and going through it would mean laundering an internal row shape through a
// staff-shaped function only to re-strip it here, which is worse, not safer.
//
// Rule 1 (identity/scope): every area function takes `ctx` and resolves "my booking" via
// `bookingForCustomerUser` — never a raw bookingId parameter from the caller — so a customer can
// never address another customer's booking by guessing an id. `assertNoDenylistedKeys` in
// `portal.test.ts` proves the object this module returns never carries a denylisted key.

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { AppError, type Ctx } from "../authz/types";
import { authorize } from "../authz/authorize";
import { requireRole } from "../authz/requireRole";
import { withTx, appendEvent, actorFields, type DbLike } from "../events";
import { bookingForCustomerUser } from "../customer";
import { t2Payments } from "../collections-view";
import { t4Passport } from "../transparency";
import { currentItems } from "../specification/revisions";
import { uploadDocument } from "../documents/checklist";
import type { SpecItems } from "../specification/baselines";
import { createNotification } from "../notifications/core";
import { createAction } from "../actions/core";
import { confirmAvailability as regConfirmAvailability } from "../registration/core";
import { confirmAppointment as hoConfirmAppointment, rescheduleAppointment as hoRescheduleAppointment } from "../handover/core";
import { raiseChangeRequest, type RaiseCrInput } from "../change-requests/capture";
import { acceptQuotation } from "../change-requests/quotation";
import { toSpecRegStatus } from "../registration/store";
import { toSpecHoStatus } from "../handover/store";
import type { ProgressState } from "../gates";

async function myBooking(ctx: Ctx): Promise<string> {
  if (ctx.actor.kind !== "CUSTOMER") throw new AppError("forbidden", "portal access requires a customer login");
  const bookingId = await bookingForCustomerUser(ctx.actor.user_id);
  if (!bookingId) throw new AppError("not_found", "no booking found for this customer");
  return bookingId;
}

async function progressFor(unitId: string): Promise<Record<string, ProgressState>> {
  const r = await db.query<{ component_code: string; state_code: ProgressState }>(`SELECT component_code, state_code FROM unit_progress WHERE unit_id = $1`, [unitId]);
  const map: Record<string, ProgressState> = {};
  for (const row of r.rows) map[row.component_code] = row.state_code;
  return map;
}

interface BookingHeader { id: string; unit_id: string; project_id: string; project_name: string; unit_number: string; unit_type: string; facing: string; status: string; total_consideration: number }

async function bookingHeader(bookingId: string, handle: DbLike = db): Promise<BookingHeader> {
  const r = await handle.query<BookingHeader>(
    `SELECT b.id, b.unit_id, b.project_id, p.name AS project_name, u.unit_number, u.unit_type, u.facing, b.status,
            b.total_consideration::float8 AS total_consideration
       FROM booking b JOIN unit u ON u.id = b.unit_id JOIN project p ON p.id = b.project_id
      WHERE b.id = $1`,
    [bookingId]
  );
  if (!r.rows[0]) throw new AppError("not_found", "booking not found");
  return r.rows[0];
}

// --- Studio: visibility & wording (rule 1's Policy Studio "customer visibility & wording" tab) ---

/** NULL project_id row = the global default; a project-scoped row overrides it. Returns
 *  {visible:true, wording:null} (show, no override) when nothing is configured — a missing
 *  Studio row must never silently hide something real. */
async function visibilityFor(entity: string, field: string, projectId: string): Promise<{ visible: boolean; wording: string | null }> {
  const r = await db.query<{ visible: boolean; customer_wording: string | null }>(
    `SELECT visible, customer_wording FROM customer_visibility_rule WHERE entity = $1 AND field = $2 AND (project_id = $3 OR project_id IS NULL) ORDER BY project_id NULLS LAST LIMIT 1`,
    [entity, field, projectId]
  );
  return { visible: r.rows[0]?.visible ?? true, wording: r.rows[0]?.customer_wording ?? null };
}

// --- Journey (rule 4: 06's customer layer) ---

const STAGE_STATUS_WORDING: Record<string, string> = {
  NOT_STARTED: "Not started", IN_PROGRESS: "In progress", WAITING: "Needs your action",
  BLOCKED: "Needs your action", COMPLETED: "Completed", NOT_APPLICABLE: "Not applicable",
};

export async function getJourney(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_journey", "READ");
  const b = await bookingHeader(bookingId);
  const journey = await db.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1 ORDER BY started_at DESC LIMIT 1`, [bookingId]);
  if (!journey.rows[0]) return { stages: [], actions_required: [] };
  const journeyId = journey.rows[0].id;

  const stages = await db.query<{ status: string; customer_name: string | null; label: string; forecast_start: string; forecast_end: string; customer_visible: boolean }>(
    `SELECT si.status, st.customer_name, st.name AS label, si.forecast_start::text AS forecast_start, si.forecast_end::text AS forecast_end, st.customer_visible
       FROM stage_instance si JOIN journey_stage_template st ON st.code = si.stage_code
      WHERE si.journey_id = $1 AND st.customer_visible = true
      ORDER BY si.baseline_start`,
    [journeyId]
  );

  const actions = await db.query<{ id: string; customer_title: string | null; title: string; status: string; due_at: string | null }>(
    `SELECT id, customer_title, title, status, due_at::text AS due_at FROM action WHERE booking_id = $1 AND customer_visible = true AND status NOT IN ('Closed', 'Cancelled') ORDER BY due_at NULLS LAST`,
    [bookingId]
  );

  return {
    stages: stages.rows.map((s) => ({
      label: s.customer_name ?? s.label,
      // Rule 3: only what's already approved into the journey — a stage's own forecast dates —
      // shows as a range; no separate "published" flag exists on stage_instance to gate this
      // further, so this reuses the same forward-window wording precedent `transparency.ts::t6Keys`
      // already established rather than inventing a stricter gate this schema can't back.
      status: STAGE_STATUS_WORDING[s.status] ?? "On track",
      expected_window: s.status === "COMPLETED" ? null : `${s.forecast_start} to ${s.forecast_end}`,
    })),
    actions_required: actions.rows.map((a) => ({ id: a.id, title: a.customer_title ?? a.title, due_date: a.due_at })),
  };
}

// --- Payments (rule 5: reuses transparency.ts::t2Payments, already customer-safe) ---

export async function getPayments(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_financials", "READ");
  const b = await bookingHeader(bookingId);
  const progress = await progressFor(b.unit_id);
  const payments = await t2Payments(bookingId, progress);

  const tds = await db.query<{ applicability: string; status: string; amount: number | null }>(
    `SELECT applicability, status, amount::float8 AS amount FROM tds_record WHERE booking_id = $1 ORDER BY created_at`,
    [bookingId]
  );

  const loan = await db.query<{ lender_name: string | null; stage: string; sanctioned_amount_inr: number | null }>(
    `SELECT lender_name, stage, sanctioned_amount_inr::float8 AS sanctioned_amount_inr FROM loan_case WHERE booking_id = $1 ORDER BY id LIMIT 1`,
    [bookingId]
  );

  return {
    ...payments,
    tds: tds.rows.map((t) => ({ status: t.applicability === "APPLICABLE" ? t.status : "Not applicable", amount: t.amount })),
    // No 22 "statement PDF" family is generated anywhere yet — flagged, not faked.
    loan_summary: loan.rows[0] ? { lender: loan.rows[0].lender_name, stage: loan.rows[0].stage, sanctioned_amount_inr: loan.rows[0].sanctioned_amount_inr } : null,
    statement_pdf: null,
  };
}

// --- Documents (rule 6: 22's customer_document + doc_factory_document) ---

const DOC_CATEGORY_LABEL: Record<string, string> = {
  PAN: "PAN card", IDENTITY_PROOF: "Identity proof", ADDRESS_PROOF: "Address proof", PHOTOGRAPH: "Photograph",
  PASSPORT: "Passport", OCI: "OCI card", BOOKING_FORM: "Booking form", COST_SHEET: "Cost sheet",
  AGREEMENT: "Agreement", TDS_CHALLAN: "TDS challan", LOAN_DOCUMENTS: "Loan documents",
  REGISTRATION_DOCUMENTS: "Registration documents", POA: "Power of attorney", HANDOVER_DOCUMENTS: "Handover documents", OTHER: "Other",
};

export async function getDocuments(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_documents", "READ");

  const required = await db.query<{ id: string; category: string; status: string }>(
    `SELECT cd.id, cd.category, cd.status FROM customer_document cd
       JOIN customer c ON c.id = cd.customer_id
       JOIN booking_applicant ba ON ba.customer_id = c.id
      WHERE ba.booking_id = $1 AND cd.applicable = true AND cd.status IN ('REQUIRED', 'REQUESTED', 'REJECTED')
      ORDER BY cd.category`,
    [bookingId]
  );

  const drafts = await db.query<{ id: string; family_code: string; version: number }>(
    `SELECT id, family_code, version FROM doc_factory_document WHERE booking_id = $1 AND status = 'CUSTOMER_REVIEW' ORDER BY generated_at DESC`,
    [bookingId]
  );
  const draftComments = await Promise.all(
    drafts.rows.map(async (d) => {
      const dev = await db.query<{ proposed: string; reason: string }>(`SELECT proposed, reason FROM document_deviation WHERE document_id = $1 ORDER BY created_at`, [d.id]);
      return { id: d.id, family: d.family_code, comments: dev.rows.map((x) => ({ note: x.proposed, reason: x.reason })) };
    })
  );

  const finals = await db.query<{ id: string; family_code: string; checksum: string | null; generated_at: string }>(
    `SELECT id, family_code, checksum, generated_at::text AS generated_at FROM doc_factory_document WHERE booking_id = $1 AND status IN ('EXECUTED', 'FINAL', 'ARCHIVED') ORDER BY generated_at DESC`,
    [bookingId]
  );

  return {
    required_from_you: required.rows.map((r) => ({ id: r.id, label: DOC_CATEGORY_LABEL[r.category] ?? r.category, status: r.status === "REJECTED" ? "Please re-upload" : "Upload needed" })),
    for_your_review: draftComments,
    executed: finals.rows.map((f) => ({ id: f.id, label: DOC_CATEGORY_LABEL[f.family_code] ?? f.family_code, checksum: f.checksum, generated_at: f.generated_at })),
  };
}

/** Delegates the actual upload (presigned URL, file_keys, status, `document.received` event) to
 *  22's own `uploadDocument` — that's the real, tested lifecycle; duplicating it here with a bare
 *  `file_id` column that doesn't exist on customer_document was a bug, not a variant flow. This
 *  wrapper only adds the own-booking ownership check `uploadDocument` itself doesn't do (it's
 *  reused by staff-on-behalf too, so it can't assume "caller == document owner") and the
 *  customer-facing `customer.action_completed` audit event. READ is enough here — same as every
 *  other customer write in 26 — because the own-booking check below is what actually gates it,
 *  not the matrix (see seed/permissions.ts's CUSTOMER_MODULES comment). */
export async function uploadCustomerDocument(customerDocumentId: string, contentType: string, ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_documents", "READ");
  const owner = await db.query<{ booking_id: string }>(
    `SELECT ba.booking_id FROM customer_document cd JOIN booking_applicant ba ON ba.customer_id = cd.customer_id WHERE cd.id = $1`,
    [customerDocumentId]
  );
  if (owner.rows[0]?.booking_id !== bookingId) throw new AppError("forbidden", "not your document");
  const result = await uploadDocument(customerDocumentId, { content_type: contentType }, ctx);
  await withTx(undefined, async (tx) => {
    await appendEvent(tx, {
      type: "customer.action_completed",
      entity_type: "customer_document",
      entity_id: customerDocumentId,
      booking_id: bookingId,
      payload: { action: "document_uploaded" },
      ...actorFields(ctx),
    });
  });
  return result;
}

// --- Registration (rule 6) ---

export async function getRegistrationArea(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_journey", "READ");
  const r = await db.query<{ status: string; proposed_availability_dates: string[] | null; slot_datetime: string | null; sro_office: string | null; readiness: Record<string, { ok: boolean; fact: string }> }>(
    `SELECT status, proposed_availability_dates, slot_datetime::text AS slot_datetime, sro_office, readiness FROM registration_case WHERE booking_id = $1`,
    [bookingId]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    status: toSpecRegStatus(row.status),
    proposed_dates: row.proposed_availability_dates ?? [],
    slot: row.slot_datetime,
    sro_office: row.sro_office,
    // Same denylist reasoning as journey's forecast window: no per-field publish flag exists, so
    // this surfaces only the readiness facts (booleans + plain-language fact strings), never
    // `forecast_date`/`forecast_confidence` — rule 2's "unapproved forecasts" ban applies exactly here.
    outstanding: Object.entries(row.readiness ?? {}).filter(([, v]) => !v.ok).map(([, v]) => v.fact),
  };
}

export async function confirmRegistrationAvailability(dates: string[], ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await regConfirmAvailability(bookingId, dates, ctx);
  return getRegistrationArea(ctx);
}

// --- Handover (rule 6) ---

export async function getHandoverArea(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_handover", "READ");
  const r = await db.query<{ id: string; status: string; keys_issued_at: string | null }>(
    `SELECT id, status, keys_issued_at::text AS keys_issued_at FROM handover_record WHERE booking_id = $1`,
    [bookingId]
  );
  if (!r.rows[0]) return null;
  const appt = await db.query<{ proposed_slots: string[]; confirmed_slot: string | null }>(
    `SELECT proposed_slots, confirmed_slot::text AS confirmed_slot FROM handover_appointment WHERE case_id = $1`,
    [r.rows[0].id]
  );
  const checklist = await db.query<{ groups: Record<string, Record<string, { done: boolean }>> }>(`SELECT groups FROM handover_checklist WHERE case_id = $1`, [r.rows[0].id]);
  const groups = checklist.rows[0]?.groups ?? {};
  const summary = Object.entries(groups).map(([group, items]) => ({
    group,
    done: Object.values(items).filter((i) => i.done).length,
    total: Object.values(items).length,
  }));
  return {
    status: toSpecHoStatus(r.rows[0].status),
    proposed_slots: appt.rows[0]?.proposed_slots ?? [],
    confirmed_slot: appt.rows[0]?.confirmed_slot ?? null,
    checklist_summary: summary,
    possession_letter_ready: r.rows[0].keys_issued_at !== null,
  };
}

export async function confirmHandoverAppointment(slot: string, ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await hoConfirmAppointment(bookingId, { slot, confirmed_by: "CUSTOMER_PORTAL" }, ctx);
  return getHandoverArea(ctx);
}

export async function rescheduleHandoverAppointment(slot: string, reason: string, ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await hoRescheduleAppointment(bookingId, { slot, reason }, ctx);
  return getHandoverArea(ctx);
}

// --- Requests: customisations (18) + snags (15) + service requests (30, not built) ---

const CR_STATUS_WORDING: Record<string, string> = {
  DRAFT: "Draft", REQUESTED: "Received", FEASIBILITY_REVIEW: "Being reviewed", COSTING: "Being costed",
  AWAITING_APPROVAL: "Being reviewed", AWAITING_CUSTOMER: "Waiting on your decision", AWAITING_PAYMENT: "Waiting on payment",
  APPROVED: "Approved", RELEASED: "In progress", IN_PROGRESS: "In progress", READY_FOR_QA: "Being verified",
  QA_VERIFIED: "Verified", CUSTOMER_ACCEPTED: "Completed", AS_BUILT_CLOSED: "Completed",
  REJECTED: "Not approved", WITHDRAWN: "Withdrawn", CANCELLED: "Cancelled",
};

export async function getRequests(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_journey", "READ");
  const b = await bookingHeader(bookingId);

  const crs = await db.query<{ id: string; code: string; title: string; status: string; created_at: string }>(
    `SELECT id, code, title, status, created_at::text AS created_at FROM change_request WHERE booking_id = $1 ORDER BY created_at DESC`,
    [bookingId]
  );
  const requests = await Promise.all(
    crs.rows.map(async (cr) => {
      const quote = await db.query<{ id: string; subtotal_inr: number; tax_inr: number; status: string; valid_until: string | null }>(
        `SELECT id, subtotal_inr::float8 AS subtotal_inr, tax_inr::float8 AS tax_inr, status, valid_until::text AS valid_until FROM quotation WHERE cr_id = $1 ORDER BY version DESC LIMIT 1`,
        [cr.id]
      );
      return {
        id: cr.id, code: cr.code, title: cr.title, status: CR_STATUS_WORDING[cr.status] ?? cr.status, raised_at: cr.created_at,
        quotation: quote.rows[0] ? { id: quote.rows[0].id, total_inr: quote.rows[0].subtotal_inr + quote.rows[0].tax_inr, status: quote.rows[0].status, valid_until: quote.rows[0].valid_until } : null,
      };
    })
  );

  const categories = await db.query<{ code: string; customer_label: string }>(`SELECT code, customer_label FROM change_category WHERE customer_visible = true ORDER BY sort_order`);

  const snags = await db.query<{ location: string; trade: string; severity: string; status: string; created_at: string }>(
    `SELECT location, trade, severity, status, created_at::text AS created_at FROM snag WHERE unit_id = $1 ORDER BY created_at DESC`,
    [b.unit_id]
  );

  return {
    requests,
    raisable_categories: categories.rows.map((c) => ({ code: c.code, label: c.customer_label })),
    snags: snags.rows.map((s) => ({ location: s.location, trade: s.trade, severity: s.severity, status: s.status === "closed" || s.status === "verified" ? "Fixed" : "Open" })),
    // 30 (post-handover service requests) isn't built — flagged, not faked.
    service_requests: [],
  };
}

export async function raiseCustomerRequest(input: Omit<RaiseCrInput, "raised_by_kind">, ctx: Ctx) {
  await myBooking(ctx);
  const cr = await raiseChangeRequest({ ...input, raised_by_kind: "CUSTOMER_PORTAL" }, ctx);
  return { id: cr.id, code: cr.code, status: CR_STATUS_WORDING[cr.status] ?? cr.status };
}

export async function acceptCustomerQuotation(quotationId: string, ctx: Ctx) {
  await myBooking(ctx);
  const q = await acceptQuotation(quotationId, { accepted_via: "PORTAL" }, ctx);
  return { id: q.id, status: q.status };
}

// --- Commitments (rule 8: customer_facing only, never root cause / owner) ---

const COMMITMENT_STATUS_WORDING: Record<string, string> = {
  DRAFT: "Committed", APPROVED: "Committed", ACTIVE: "Committed", AT_RISK: "Committed",
  FULFILLED: "Delivered", BREACHED: "Delayed", WAIVED_CANCELLED: "Cancelled",
};

export async function getCommitments(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_commitments", "READ");
  const b = await bookingHeader(bookingId);
  const rows = await db.query<{ description: string; due_date: string | null; recovery_due_date: string | null; status: string }>(
    `SELECT description, due_date::text AS due_date, recovery_due_date::text AS recovery_due_date, status FROM commitment WHERE booking_id = $1 AND customer_facing = true ORDER BY committed_at DESC`,
    [bookingId]
  );
  const visible = await visibilityFor("COMMITMENT", "description", b.project_id);
  if (!visible.visible) return [];
  return rows.rows.map((c) => ({
    description: c.description,
    promised_date: c.status === "BREACHED" ? c.recovery_due_date ?? c.due_date : c.due_date,
    status: c.status === "BREACHED" ? `Delayed — new date ${c.recovery_due_date ?? "to be confirmed"}` : COMMITMENT_STATUS_WORDING[c.status] ?? "Committed",
  }));
}

// `currentItems` throws when a unit has no `unit_specification` row — a real, common case per
// 09's own Build note ("a unit with no APPROVED baseline ... is left unattached with a named
// blocker rather than throwing" at `ensureUnitSpecification` time). A missing baseline must not
// break the whole My Home / Passport page — it means "as-built spec not available yet", not a 500.
async function safeCurrentItems(unitId: string): Promise<SpecItems> {
  try {
    return await currentItems(unitId);
  } catch {
    return {};
  }
}

// --- Home Passport (rule 9: reuses transparency.ts::t4Passport; service_history is 30's real one) ---

export async function getPassport(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_unit_readiness", "READ");
  const b = await bookingHeader(bookingId);
  const equipment = await t4Passport(b.unit_id);
  const asBuilt = await safeCurrentItems(b.unit_id);
  // 30 (post-handover) has since landed — `service_history` is real, append-only per unit.
  const history = await db.query<{ event_type: string; description: string; occurred_at: string }>(
    `SELECT event_type, description, occurred_at::text AS occurred_at FROM service_history WHERE unit_id = $1 ORDER BY occurred_at DESC`,
    [b.unit_id]
  );
  return {
    equipment,
    as_built_spec: Object.entries(asBuilt).map(([category, item]) => ({ category, spec: item.spec, brand_model: item.brand_model ?? null })),
    service_history: history.rows,
  };
}

// --- My Home (unit, hierarchy, as-built) ---

export async function getMyHome(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_journey", "READ");
  const b = await bookingHeader(bookingId);
  const asBuilt = await safeCurrentItems(b.unit_id);
  return {
    project_name: b.project_name,
    unit_number: b.unit_number,
    unit_type: b.unit_type,
    facing: b.facing,
    as_built_spec: Object.entries(asBuilt).map(([category, item]) => ({ category, spec: item.spec, brand_model: item.brand_model ?? null })),
    // Drawing browsing needs its own file-listing query beyond `currentItems` — not built this
    // pass, flagged not faked.
    drawings: [],
  };
}

// --- Home (overview) ---

export async function getOverview(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_journey", "READ");
  const b = await bookingHeader(bookingId);
  const journeyStrip = await getJourney(ctx);
  const latestUpdate = await db.query<{ id: string; title: string; body: string; published_at: string }>(
    `SELECT id, title, body, published_at::text AS published_at FROM customer_update WHERE booking_id = $1 AND status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 1`,
    [bookingId]
  );
  const nextAction = journeyStrip.actions_required[0] ?? null;
  return {
    project_name: b.project_name,
    unit_number: b.unit_number,
    next_action: nextAction,
    latest_update: latestUpdate.rows[0] ?? null,
    journey_strip: journeyStrip.stages,
  };
}

// --- Updates feed (rule 10) ---

export async function getUpdates(ctx: Ctx) {
  const bookingId = await myBooking(ctx);
  await authorize(ctx, "customer_journey", "READ");
  const r = await db.query<{ id: string; kind: string; title: string; body: string; published_at: string }>(
    `SELECT id, kind, title, body, published_at::text AS published_at FROM customer_update WHERE booking_id = $1 AND status = 'PUBLISHED' ORDER BY published_at DESC`,
    [bookingId]
  );
  return r.rows;
}

// --- Check-ins (rule 10) ---

/** "System sends" (portal prompt + email) at 7/30/90 days after handover, or DLP close — no
 *  scheduler exists anywhere in this codebase (same pre-existing gap 06/12/19/21 already
 *  document), so this is directly callable with a controlled kind/asOf and tested, not
 *  cron-wired, matching that same precedent exactly. */
export async function sendCheckIn(bookingId: string, kind: "DAY_7" | "DAY_30" | "DAY_90" | "DLP_CLOSE"): Promise<{ id: string }> {
  const existing = await db.query<{ id: string }>(`SELECT id FROM customer_check_in WHERE booking_id = $1 AND kind = $2`, [bookingId, kind]);
  if (existing.rows[0]) return existing.rows[0];
  const id = "ci_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    await tx.query(`INSERT INTO customer_check_in (id, booking_id, kind, sent_at) VALUES ($1,$2,$3,now())`, [id, bookingId, kind]);
    await appendEvent(tx, {
      type: "check_in.sent",
      entity_type: "customer_check_in",
      entity_id: id,
      booking_id: bookingId,
      payload: { kind },
      actor_user_id: null,
      actor_kind: "SYSTEM",
    });
    const login = await tx.query<{ user_id: string }>(`SELECT user_id FROM customer_login WHERE booking_id = $1 LIMIT 1`, [bookingId]);
    if (login.rows[0]) {
      await createNotification({ user_id: login.rows[0].user_id, type: "check_in.sent", title: "How's everything going?", body: "We'd love to hear how things are going — please take a moment to rate your experience." }, tx);
    }
  });
  return { id };
}

export async function submitCheckIn(checkInId: string, input: { score: number; comment?: string }, ctx: Ctx): Promise<void> {
  const bookingId = await myBooking(ctx);
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) throw new AppError("validation", "score must be an integer between 1 and 5", "score");
  const owner = await db.query<{ booking_id: string; responded_at: string | null }>(`SELECT booking_id, responded_at::text AS responded_at FROM customer_check_in WHERE id = $1`, [checkInId]);
  if (owner.rows[0]?.booking_id !== bookingId) throw new AppError("not_found", "check-in not found");
  if (owner.rows[0].responded_at) throw new AppError("conflict", "this check-in was already answered");

  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE customer_check_in SET responded_at = now(), score = $2, comment = $3 WHERE id = $1`, [checkInId, input.score, input.comment ?? null]);
    await appendEvent(tx, {
      type: "check_in.responded",
      entity_type: "customer_check_in",
      entity_id: checkInId,
      booking_id: bookingId,
      payload: { score: input.score },
      ...actorFields(ctx),
    });
    // Rule 10: a low score (<=2) raises a real CRM action rather than only being visible on a
    // dashboard someone has to remember to check.
    if (input.score <= 2) {
      const b = await bookingHeader(bookingId, tx);
      const actionId = await createAction(
        {
          type: "exec_simple",
          title: `Low check-in score (${input.score}/5) on booking`,
          description: input.comment ?? undefined,
          project_id: b.project_id,
          source_module: "portal",
          source_entity_type: "customer_check_in",
          source_entity_id: checkInId,
          booking_id: bookingId,
          owner_role: "CRM",
          priority: "HIGH",
          origin: "AUTO",
        },
        tx
      );
      await tx.query(`UPDATE customer_check_in SET follow_up_action_id = $2 WHERE id = $1`, [checkInId, actionId]);
    }
  });
}

// --- CRM side: draft/publish customer updates (rule 10) ---

export const CRM_UPDATE_ROLES = ["CRM", "MANAGEMENT", "SUPER_ADMIN"];

export interface CustomerUpdateRow { id: string; kind: string; title: string; body: string; status: "DRAFT" | "PUBLISHED"; source_event_id: string | null; created_at: string }

export async function listDraftUpdates(bookingId: string, ctx: Ctx): Promise<CustomerUpdateRow[]> {
  requireRole(ctx, CRM_UPDATE_ROLES);
  const r = await db.query<CustomerUpdateRow>(`SELECT id, kind, title, body, status, source_event_id, created_at::text AS created_at FROM customer_update WHERE booking_id = $1 ORDER BY created_at DESC`, [bookingId]);
  return r.rows;
}

export async function publishUpdate(id: string, edits: { title?: string; body?: string } | undefined, ctx: Ctx) {
  requireRole(ctx, CRM_UPDATE_ROLES);
  const row = await db.query<{ booking_id: string; status: string }>(`SELECT booking_id, status FROM customer_update WHERE id = $1`, [id]);
  if (!row.rows[0]) throw new AppError("not_found", "update not found");
  if (row.rows[0].status === "PUBLISHED") throw new AppError("conflict", "already published");

  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE customer_update SET status = 'PUBLISHED', published_by = $2, published_at = now(), title = COALESCE($3, title), body = COALESCE($4, body) WHERE id = $1`,
      [id, ctx.actor.user_id, edits?.title ?? null, edits?.body ?? null]
    );
    await appendEvent(tx, {
      type: "customer_update.published",
      entity_type: "customer_update",
      entity_id: id,
      booking_id: row.rows[0].booking_id,
      payload: {},
      ...actorFields(ctx),
    });
    const login = await tx.query<{ user_id: string }>(`SELECT user_id FROM customer_login WHERE booking_id = $1 LIMIT 1`, [row.rows[0].booking_id]);
    if (login.rows[0]) {
      const finalRow = await tx.query<{ title: string; body: string }>(`SELECT title, body FROM customer_update WHERE id = $1`, [id]);
      await createNotification({ user_id: login.rows[0].user_id, type: "customer_update.published", title: finalRow.rows[0]?.title ?? "Update", body: finalRow.rows[0]?.body }, tx);
    }
  });
}
