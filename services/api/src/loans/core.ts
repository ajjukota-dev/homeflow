import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { createAction } from "../actions/core";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { DEMAND_SELECT, mapDemands, today } from "../demands";
import { updateClearanceChecklist } from "../financial-clearance";
import { computeLoanRisk, type LoanRiskInput, type LoanRiskResult, type LoanStage } from "./risk";

export type { LoanStage } from "./risk";

// 21-loans.md. `loan_case` is real (0000_init.sql), richened by 0026_loans.sql — see that
// migration's header for the rename/reconciliation. Depends on 19 (built, reused directly:
// DEMAND_SELECT/mapDemands for remaining balances, updateClearanceChecklist for the
// bank_disbursement_applicable flag) and 10 (built, reused via createAction for the
// rejection/withdrawal follow-up and rule 3/5's Banking nudges). Genuinely blocked forward
// dependencies, flagged not faked: 12 (escalations) doesn't exist, so rule 4's "escalation
// [E §11.1]" fires as a Banking createAction instead of a real escalation row — same substitute
// this codebase already uses elsewhere for an unbuilt spec 12. 22 (document categories) doesn't
// exist, so loan_document_requirement.category is free text, not a real category FK. 14
// (readiness scores / universal ScoreCard contract) doesn't exist, so risk.ts computes rule 5's
// named drivers directly rather than conforming to 14's shape — see risk.ts's own header.
//
// Authorization: seed/permissions.ts's `loans` module row is emergent-business-rules.md §1.3
// verbatim (MANAGEMENT=R, ACCOUNTS=R, BANKING=W, CRM=R, others=N) — every WRITE call below is
// gated WRITE, so only BANKING (and SUPER_ADMIN via its ADMIN row) can create/patch/record events.
// §6 separately reports routers/loans.py's endpoint-level check as writers = {BANKING, ACCOUNTS,
// MANAGEMENT}, and 21's own rule 7 prose repeats that wider set — but permission_matrix is the
// seeded artifact §1.3 is explicitly sourced into (seed/permissions.ts's own header), so it's the
// more authoritative of the two here, not §6's router-code observation. Left as an open question
// for Amarsh rather than resolved unilaterally — see TODO.md's "Found while building" log. If he
// confirms §6's wider set, widen this module's WRITE gate then (not by editing the seeded matrix).

const TERMINAL_STAGES: LoanStage[] = ["CLOSED", "REJECTED", "WITHDRAWN"];
const DISBURSEMENT_TOLERANCE_PCT = 1; // rule 2's own literal

const MS_PER_DAY = 86_400_000;
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

export interface LoanCaseRow {
  id: string;
  code: string;
  booking_id: string;
  project_id: string;
  customer_id: string | null;
  lender_name: string | null;
  lender_branch: string | null;
  lender_rm_name: string | null;
  lender_rm_contact: string | null;
  requested_amount_inr: number | null;
  sanctioned_amount_inr: number | null;
  sanction_date: string | null;
  sanction_validity_date: string | null;
  sanction_letter_file_id: string | null;
  stage: LoanStage;
  own_contribution_inr: number | null;
  expected_disbursement_date: string | null;
  blocker: string | null;
  risk_score: number | null;
  missing_docs: string[];
  notes: string | null;
  owner_user_id: string | null;
  created_at: string;
  disbursed_amount_inr: number;
}

const LOAN_SELECT = `
  SELECT lc.id, lc.code, lc.booking_id, lc.project_id, lc.customer_id, lc.lender_name, lc.lender_branch,
         lc.lender_rm_name, lc.lender_rm_contact, lc.requested_amount_inr::float8 AS requested_amount_inr,
         lc.sanctioned_amount_inr::float8 AS sanctioned_amount_inr, lc.sanction_date::text AS sanction_date,
         lc.sanction_validity_date::text AS sanction_validity_date, lc.sanction_letter_file_id, lc.stage,
         lc.own_contribution_inr::float8 AS own_contribution_inr,
         lc.expected_disbursement_date::text AS expected_disbursement_date,
         lc.blocker, lc.risk_score, lc.missing_docs, lc.notes, lc.owner_user_id, lc.created_at::text AS created_at,
         COALESCE((SELECT SUM(amount_inr) FROM loan_event WHERE loan_id = lc.id AND type = 'DISBURSED'), 0)::float8 AS disbursed_amount_inr
    FROM loan_case lc
`;

async function mapLoan(handle: DbLike, sql: string, params: unknown[]): Promise<LoanCaseRow[]> {
  const r = await handle.query<LoanCaseRow>(sql, params);
  return r.rows.map((row) => ({ ...row, missing_docs: Array.isArray(row.missing_docs) ? row.missing_docs : [] }));
}

async function requireLoan(handle: DbLike, id: string): Promise<LoanCaseRow> {
  const rows = await mapLoan(handle, `${LOAN_SELECT} WHERE lc.id = $1`, [id]);
  if (!rows[0]) throw new AppError("not_found", "loan case not found");
  return rows[0];
}

/** Rule 1/6: flip every not-yet-settled demand on the booking together — simplified from the
 *  spec's "for the sanctioned share" (which implies partial per-demand-amount allocation; nothing
 *  else in this schema models partial loan coverage of a single demand, and building that
 *  allocation machinery isn't otherwise needed — flagged, not silently guessed). */
async function setBookingLoanDependent(tx: DbLike, bookingId: string, value: boolean): Promise<void> {
  await tx.query(`UPDATE demand SET loan_dependent = $1 WHERE booking_id = $2 AND status NOT IN ('settled', 'waived')`, [value, bookingId]);
}

/** financial-clearance.ts's loadOrCreateRow/updateClearanceChecklist use the bare module-level
 *  `db`, not tx-forwarding — called sequentially AFTER this module's own transaction commits,
 *  same discipline financial-clearance.ts's own approveClearance/rejectClearance document, to
 *  avoid the same-connection deadlock a nested db.query while a transaction is open would cause.
 *  Both purposes (REGISTRATION and HANDOVER) get the flag — a bank disbursement is a fact about
 *  the booking, not specific to which gate is being evaluated. */
async function setBankDisbursementApplicable(bookingId: string, value: boolean, ctx: Ctx): Promise<void> {
  await updateClearanceChecklist(bookingId, "REGISTRATION", { bank_disbursement_applicable: value }, ctx);
  await updateClearanceChecklist(bookingId, "HANDOVER", { bank_disbursement_applicable: value }, ctx);
}

export async function createLoanCase(
  bookingId: string,
  input: { lender_name?: string; requested_amount_inr: number; own_contribution_inr?: number },
  ctx: Ctx
): Promise<LoanCaseRow> {
  await authorize(ctx, "loans", "WRITE");
  if (!Number.isFinite(input.requested_amount_inr) || input.requested_amount_inr <= 0) {
    throw new AppError("validation", "requested_amount_inr must be positive", "requested_amount_inr");
  }
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM loan_case WHERE booking_id = $1 AND stage NOT IN ('CLOSED','REJECTED','WITHDRAWN')`,
    [bookingId]
  );
  if (existing.rows[0]) throw new AppError("conflict", "an active loan case already exists for this booking"); // rule 1

  const b = await db.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [bookingId]);
  if (!b.rows[0]) throw new AppError("not_found", "booking not found");
  const projectId = b.rows[0].project_id;

  const id = "lc_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    const code = await nextCode(tx, "LN");
    await tx.query(
      `INSERT INTO loan_case (id, code, booking_id, project_id, lender_name, requested_amount_inr, own_contribution_inr)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, code, bookingId, projectId, input.lender_name ?? null, input.requested_amount_inr, input.own_contribution_inr ?? null]
    );
    await tx.query(`INSERT INTO loan_event (id, loan_id, type, actor_user_id) VALUES ($1,$2,'APPLICATION_SUBMITTED',$3)`, [
      "le_" + randomUUID().slice(0, 8),
      id,
      ctx.actor.user_id,
    ]);
    await setBookingLoanDependent(tx, bookingId, true);
    await appendEvent(tx, {
      type: "loan.application_submitted",
      entity_type: "loan_case",
      entity_id: id,
      project_id: projectId,
      booking_id: bookingId,
      payload: { requested_amount_inr: input.requested_amount_inr },
      ...actorFields(ctx),
    });
  });
  await setBankDisbursementApplicable(bookingId, true, ctx); // rule 1
  return requireLoan(db, id);
}

export interface LoanPatchInput {
  lender_name?: string | null;
  lender_branch?: string | null;
  lender_rm_name?: string | null;
  lender_rm_contact?: string | null;
  sanctioned_amount_inr?: number | null;
  sanction_date?: string | null;
  sanction_validity_date?: string | null;
  sanction_letter_file_id?: string | null;
  expected_disbursement_date?: string | null;
  own_contribution_inr?: number | null;
  owner_user_id?: string | null;
  notes?: string | null;
}

const PATCHABLE_COLUMNS: (keyof LoanPatchInput)[] = [
  "lender_name",
  "lender_branch",
  "lender_rm_name",
  "lender_rm_contact",
  "sanctioned_amount_inr",
  "sanction_date",
  "sanction_validity_date",
  "sanction_letter_file_id",
  "expected_disbursement_date",
  "own_contribution_inr",
  "owner_user_id",
  "notes",
];

/** PATCH /loans/:id — field updates only (lender info, sanction terms, notes). Stage transitions
 *  and the audit trail go through recordLoanEvent instead — SANCTIONED's event handler requires
 *  sanctioned_amount_inr/sanction_date/sanction_validity_date to already be set via this first. */
export async function patchLoanCase(id: string, input: LoanPatchInput, ctx: Ctx): Promise<LoanCaseRow> {
  await authorize(ctx, "loans", "WRITE");
  const loan = await requireLoan(db, id);
  if (TERMINAL_STAGES.includes(loan.stage)) throw new AppError("conflict", `loan case is ${loan.stage}`);

  const cols = (Object.keys(input) as (keyof LoanPatchInput)[]).filter((k) => PATCHABLE_COLUMNS.includes(k));
  if (cols.length === 0) return loan;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  await db.query(`UPDATE loan_case SET ${sets} WHERE id = $1`, [id, ...cols.map((c) => input[c] ?? null)]);
  return requireLoan(db, id);
}

export interface LoanEventInput {
  type:
    | "SANCTIONED"
    | "DOCS_REQUESTED"
    | "DOCS_RECEIVED"
    | "DISBURSEMENT_REQUESTED"
    | "DISBURSED"
    | "BLOCKER_RECORDED"
    | "BLOCKER_RESOLVED"
    | "REJECTED"
    | "WITHDRAWN";
  amount_inr?: number;
  note?: string;
}

async function logLoanEvent(tx: DbLike, loanId: string, type: string, ctx: Ctx, extra: { amount_inr?: number | null; receipt_id?: string | null; note?: string | null } = {}): Promise<void> {
  await tx.query(
    `INSERT INTO loan_event (id, loan_id, type, amount_inr, receipt_id, note, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ["le_" + randomUUID().slice(0, 8), loanId, type, extra.amount_inr ?? null, extra.receipt_id ?? null, extra.note ?? null, ctx.actor.user_id]
  );
}

/** POST /loans/:id/events — rule 2's disbursement waterfall (across loan_dependent demands,
 *  oldest-due first, same "allow early payment against a scheduled demand" precedent 19 already
 *  established), rule 1's rejection/withdrawal reversal + CRM follow-up action, and every other
 *  stage transition rule 21's Events list names. */
export async function recordLoanEvent(id: string, input: LoanEventInput, ctx: Ctx): Promise<LoanCaseRow> {
  await authorize(ctx, "loans", "WRITE");
  const loan = await requireLoan(db, id);
  if (TERMINAL_STAGES.includes(loan.stage)) throw new AppError("conflict", `loan case is already ${loan.stage}`);

  if (input.type === "SANCTIONED") {
    if (loan.sanctioned_amount_inr === null || loan.sanction_date === null || loan.sanction_validity_date === null) {
      throw new AppError("validation", "sanctioned_amount_inr, sanction_date and sanction_validity_date must be set (PATCH first) before recording SANCTIONED");
    }
    await withTx(undefined, async (tx) => {
      await tx.query(`UPDATE loan_case SET stage = 'SANCTIONED' WHERE id = $1`, [id]);
      await logLoanEvent(tx, id, "SANCTIONED", ctx, { note: input.note });
      await appendEvent(tx, {
        type: "loan.sanction_received",
        entity_type: "loan_case",
        entity_id: id,
        project_id: loan.project_id,
        booking_id: loan.booking_id,
        payload: { sanctioned_amount_inr: loan.sanctioned_amount_inr },
        ...actorFields(ctx),
      });
    });
    return requireLoan(db, id);
  }

  if (input.type === "DISBURSED") {
    if (!["SANCTIONED", "DOCS_PENDING", "DISBURSEMENT_SCHEDULED", "PARTIALLY_DISBURSED"].includes(loan.stage)) {
      throw new AppError("conflict", "disbursement requires the loan to be sanctioned or later"); // rule 2
    }
    if (typeof input.amount_inr !== "number" || !Number.isFinite(input.amount_inr) || input.amount_inr <= 0) {
      throw new AppError("validation", "amount_inr is required and must be positive", "amount_inr");
    }
    if (loan.sanctioned_amount_inr === null) throw new AppError("conflict", "loan has no sanctioned amount recorded yet");
    const cumulative = loan.disbursed_amount_inr + input.amount_inr;
    const tolerance = loan.sanctioned_amount_inr * (1 + DISBURSEMENT_TOLERANCE_PCT / 100);
    if (cumulative > tolerance + 1e-6) {
      throw new AppError("validation", `disbursement would exceed sanctioned amount + ${DISBURSEMENT_TOLERANCE_PCT}% tolerance`, "amount_inr");
    }

    const demands = await mapDemands(
      `${DEMAND_SELECT} WHERE d.booking_id = $1 AND d.loan_dependent = true AND d.status NOT IN ('settled','waived') ORDER BY d.due_date NULLS LAST, d.sequence`,
      [loan.booking_id]
    );
    let toAllocate = input.amount_inr;
    let firstReceiptId: string | null = null;
    const newStage: LoanStage = cumulative >= loan.sanctioned_amount_inr - 1e-6 ? "FULLY_DISBURSED" : "PARTIALLY_DISBURSED";

    await withTx(undefined, async (tx) => {
      for (const d of demands) {
        if (toAllocate <= 0) break;
        const alloc = Math.min(toAllocate, d.remaining);
        if (alloc <= 0) continue;
        const receiptId = randomUUID();
        await tx.query(
          `INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, mode, status) VALUES ($1,$2,$3,$4,$5,'LOAN_DISBURSEMENT','reconciled')`,
          [receiptId, loan.booking_id, loan.project_id, d.id, alloc]
        );
        await tx.query(`UPDATE demand SET status = $1 WHERE id = $2`, [alloc >= d.remaining - 1e-6 ? "settled" : "part_paid", d.id]);
        await appendEvent(tx, {
          type: "payment.received",
          entity_type: "receipt",
          entity_id: receiptId,
          project_id: loan.project_id,
          booking_id: loan.booking_id,
          payload: { demand_id: d.id, amount: alloc, mode: "LOAN_DISBURSEMENT" },
          ...actorFields(ctx),
        });
        firstReceiptId ??= receiptId;
        toAllocate -= alloc;
      }
      await tx.query(`UPDATE loan_case SET stage = $1 WHERE id = $2`, [newStage, id]);
      await logLoanEvent(tx, id, "DISBURSED", ctx, { amount_inr: input.amount_inr, receipt_id: firstReceiptId, note: input.note });
      await appendEvent(tx, {
        type: "loan.disbursement_received",
        entity_type: "loan_case",
        entity_id: id,
        project_id: loan.project_id,
        booking_id: loan.booking_id,
        payload: { amount_inr: input.amount_inr, stage: newStage },
        ...actorFields(ctx),
      });
    });
    return requireLoan(db, id);
  }

  if (input.type === "REJECTED" || input.type === "WITHDRAWN") {
    await withTx(undefined, async (tx) => {
      await tx.query(`UPDATE loan_case SET stage = $1 WHERE id = $2`, [input.type, id]);
      await setBookingLoanDependent(tx, loan.booking_id, false); // rule 1
      await logLoanEvent(tx, id, input.type as string, ctx, { note: input.note });
      await createAction(
        {
          type: "exec_simple",
          title: `Move ${loan.code} demands to customer-due (loan ${input.type!.toLowerCase()})`,
          project_id: loan.project_id,
          source_module: "loans",
          source_entity_type: "loan_case",
          source_entity_id: id,
          booking_id: loan.booking_id,
          owner_role: "CRM",
          origin: "AUTO",
        },
        tx
      );
      // Spec's Events list names only "loan.rejected" — reusing it for WITHDRAWN would record a
      // false audit trail (same class of gap waivers.ts already found and fixed for its own
      // rejected/approved split); loan.withdrawn is a sanctioned extension, added to the registry.
      await appendEvent(tx, {
        type: input.type === "REJECTED" ? "loan.rejected" : "loan.withdrawn",
        entity_type: "loan_case",
        entity_id: id,
        project_id: loan.project_id,
        booking_id: loan.booking_id,
        payload: { reason: input.note ?? null },
        ...actorFields(ctx),
      });
    });
    await setBankDisbursementApplicable(loan.booking_id, false, ctx); // rule 1
    return requireLoan(db, id);
  }

  // DOCS_REQUESTED, DOCS_RECEIVED, DISBURSEMENT_REQUESTED, BLOCKER_RECORDED, BLOCKER_RESOLVED —
  // log entries; DOCS_REQUESTED/DISBURSEMENT_REQUESTED also move stage, firing loan.stage_changed
  // only when the stage actually moves. `stage` is a flat enum, not a strict linear chain — rule
  // 4's own expiry path moves SANCTIONED -> DOCS_PENDING, which a naive "never move backward in
  // enum-declaration order" check would have blocked — so these two conditions are written
  // directly from what each event legitimately means, not from a generic ordering table:
  //   DOCS_REQUESTED -> DOCS_PENDING, unless disbursement has already started (moving an
  //   in-flight disbursement "back" to docs-pending would corrupt disbursement tracking).
  //   DISBURSEMENT_REQUESTED -> DISBURSEMENT_SCHEDULED, only from SANCTIONED/DOCS_PENDING (rule
  //   2: disbursement requires sanctioned or later) — a no-op once disbursement is already
  //   underway, not a regression back to "scheduled".
  const DISBURSING_OR_LATER: LoanStage[] = ["DISBURSEMENT_SCHEDULED", "PARTIALLY_DISBURSED", "FULLY_DISBURSED"];
  let nextStage: LoanStage | undefined;
  if (input.type === "DOCS_REQUESTED" && !DISBURSING_OR_LATER.includes(loan.stage) && loan.stage !== "DOCS_PENDING") {
    nextStage = "DOCS_PENDING";
  } else if (input.type === "DISBURSEMENT_REQUESTED" && (loan.stage === "SANCTIONED" || loan.stage === "DOCS_PENDING")) {
    nextStage = "DISBURSEMENT_SCHEDULED";
  }
  const advances = nextStage !== undefined;

  await withTx(undefined, async (tx) => {
    if (input.type === "BLOCKER_RECORDED") {
      if (!input.note?.trim()) throw new AppError("validation", "note (the blocker description) is required", "note");
      await tx.query(`UPDATE loan_case SET blocker = $1 WHERE id = $2`, [input.note, id]);
    }
    if (input.type === "BLOCKER_RESOLVED") {
      await tx.query(`UPDATE loan_case SET blocker = NULL WHERE id = $1`, [id]);
    }
    if (advances) {
      await tx.query(`UPDATE loan_case SET stage = $1 WHERE id = $2`, [nextStage, id]);
    }
    await logLoanEvent(tx, id, input.type, ctx, { note: input.note });
    const eventType =
      input.type === "BLOCKER_RECORDED" ? "loan.blocker_recorded" : input.type === "BLOCKER_RESOLVED" ? "loan.blocker_resolved" : "loan.stage_changed";
    if (input.type === "BLOCKER_RECORDED" || input.type === "BLOCKER_RESOLVED" || advances) {
      await appendEvent(tx, {
        type: eventType,
        entity_type: "loan_case",
        entity_id: id,
        project_id: loan.project_id,
        booking_id: loan.booking_id,
        payload: { note: input.note ?? null, stage: advances ? nextStage : loan.stage },
        ...actorFields(ctx),
      });
    }
  });
  return requireLoan(db, id);
}

export async function putLoanDocuments(id: string, requirements: { category: string; status?: "REQUIRED" | "RECEIVED" | "VERIFIED" }[], ctx: Ctx): Promise<LoanCaseRow> {
  await authorize(ctx, "loans", "WRITE");
  const loan = await requireLoan(db, id);
  await withTx(undefined, async (tx) => {
    for (const r of requirements) {
      await tx.query(
        `INSERT INTO loan_document_requirement (id, loan_id, category, status) VALUES ($1,$2,$3,$4)
         ON CONFLICT (loan_id, category) DO UPDATE SET status = EXCLUDED.status`,
        ["ldr_" + randomUUID().slice(0, 8), id, r.category, r.status ?? "REQUIRED"]
      );
    }
    const missing = await tx.query<{ category: string }>(`SELECT category FROM loan_document_requirement WHERE loan_id = $1 AND status = 'REQUIRED'`, [id]);
    await tx.query(`UPDATE loan_case SET missing_docs = $1::jsonb WHERE id = $2`, [JSON.stringify(missing.rows.map((r) => r.category)), id]);
  });
  return requireLoan(db, loan.id);
}

export async function listProjectLoans(projectId: string, filters: { stage?: string; risk?: "high" | "low" } | undefined, ctx: Ctx): Promise<LoanCaseRow[]> {
  await authorize(ctx, "loans", "READ");
  const conds = ["lc.project_id = $1"];
  const params: unknown[] = [projectId];
  if (filters?.stage) {
    params.push(filters.stage);
    conds.push(`lc.stage = $${params.length}`);
  }
  const rows = await mapLoan(db, `${LOAN_SELECT} WHERE ${conds.join(" AND ")} ORDER BY lc.created_at DESC`, params);
  if (filters?.risk === "high") return rows.filter((r) => (r.risk_score ?? 0) >= 50);
  if (filters?.risk === "low") return rows.filter((r) => (r.risk_score ?? 0) < 50);
  return rows;
}

export async function getBookingLoan(bookingId: string, ctx: Ctx): Promise<LoanCaseRow | null> {
  await authorize(ctx, "loans", "READ");
  const rows = await mapLoan(db, `${LOAN_SELECT} WHERE lc.booking_id = $1 ORDER BY lc.created_at DESC LIMIT 1`, [bookingId]);
  return rows[0] ?? null;
}

/** GET /loans/:id/risk — rule 3's timing gap (days_to_demand vs days_to_disbursement) computed
 *  fresh from real facts (next unsettled loan-dependent demand's due_date; loan_case's own
 *  expected_disbursement_date), then fed into risk.ts's pure computeLoanRisk alongside stage age,
 *  missing docs count and lender responsiveness. Also persists risk_score onto loan_case so
 *  listProjectLoans's ?risk filter and the pipeline screen don't need to recompute per row. */
export async function getLoanRisk(id: string, ctx: Ctx): Promise<LoanRiskResult & { days_to_demand: number | null; days_to_disbursement: number | null }> {
  await authorize(ctx, "loans", "READ");
  const loan = await requireLoan(db, id);
  const asOf = today();

  const nextDemand = await db.query<{ due_date: string | null }>(
    `SELECT MIN(due_date)::text AS due_date FROM demand WHERE booking_id = $1 AND loan_dependent = true AND status NOT IN ('settled','waived') AND due_date IS NOT NULL`,
    [loan.booking_id]
  );
  const daysToDemand = nextDemand.rows[0]?.due_date ? daysBetween(asOf, nextDemand.rows[0].due_date) : null;
  const daysToDisbursement = loan.expected_disbursement_date ? daysBetween(asOf, loan.expected_disbursement_date) : null;
  const timingGapDays = daysToDemand !== null && daysToDisbursement !== null ? daysToDemand - daysToDisbursement : null;

  const lastEvent = await db.query<{ at: string }>(`SELECT at::text AS at FROM loan_event WHERE loan_id = $1 ORDER BY at DESC LIMIT 1`, [id]);
  const daysSinceLastEvent = lastEvent.rows[0] ? daysBetween(lastEvent.rows[0].at.slice(0, 10), asOf) : null;

  const validityDaysLeft = loan.sanction_validity_date && loan.stage !== "FULLY_DISBURSED" ? daysBetween(asOf, loan.sanction_validity_date) : null;

  const input: LoanRiskInput = {
    stage: loan.stage,
    stage_age_days: daysBetween(loan.created_at.slice(0, 10), asOf),
    missing_docs_count: loan.missing_docs.length,
    validity_days_left: validityDaysLeft,
    days_since_last_event: daysSinceLastEvent,
    timing_gap_days: timingGapDays,
  };
  const result = computeLoanRisk(input);
  await db.query(`UPDATE loan_case SET risk_score = $1 WHERE id = $2`, [result.score, id]);
  return { ...result, days_to_demand: daysToDemand, days_to_disbursement: daysToDisbursement };
}
