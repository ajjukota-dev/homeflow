import { randomUUID } from "node:crypto";
import { db } from "./db";
import { appendEvent, withTx } from "./events";
import { bookingFinance } from "./finance";
import { requireRole, STAFF_ROLES, POLICY_STUDIO_ROLES } from "./authz/requireRole";
import { AppError, type Ctx } from "./authz/types";

// Rule 9 (19-collections-true-risk.md): "Financial clearance: computed live; APPROVED only by
// Accounts lead/Management when checklist complete and paid >= threshold_pct; immutable after
// approval (new purpose row for handover)." The money side (paid/consideration/disputed/
// paid_pct/threshold) reuses finance.ts's bookingFinance() — H7's existing live computation,
// not reimplemented here. This module adds the checklist + approve/reject/immutability
// persistence rule 9 asks for on top of it. Registration (23) and handover FINANCIAL gate (16)
// reading this — not built, so nothing consumes it yet; same "flag, don't fake" as elsewhere.

export type ClearancePurpose = "REGISTRATION" | "HANDOVER";

export interface ClearanceChecklist {
  ledger_reconciled: boolean;
  due_amounts_paid: boolean;
  tds_verified: boolean; // caller sets this from tds.ts's own state — not auto-joined here
  bank_disbursement_applicable: boolean; // manual — auto-derivation needs 21 (loans), not built
  bank_disbursement_received: boolean;
  other_charges_cleared: boolean;
  exceptions_approved: boolean; // defaults false — Emergent defaulted true; client question, unresolved
}

const DEFAULT_CHECKLIST: ClearanceChecklist = {
  ledger_reconciled: false,
  due_amounts_paid: false,
  tds_verified: false,
  bank_disbursement_applicable: false,
  bank_disbursement_received: false,
  other_charges_cleared: false,
  exceptions_approved: false,
};

export interface ClearanceView {
  id: string;
  booking_id: string;
  purpose: ClearancePurpose;
  checklist: ClearanceChecklist;
  status: "PENDING" | "APPROVED" | "REJECTED";
  approved_by: string | null;
  threshold_pct: number;
  paid_pct: number;
  blocked_reasons: string[]; // empty = ready to approve right now
}

interface ClearanceRowRaw {
  id: string;
  booking_id: string;
  purpose: ClearancePurpose;
  checklist: ClearanceChecklist;
  status: "PENDING" | "APPROVED" | "REJECTED";
  approved_by: string | null;
  threshold_pct: number;
}

async function loadOrCreateRow(bookingId: string, purpose: ClearancePurpose): Promise<ClearanceRowRaw> {
  const existing = await db.query<ClearanceRowRaw>(
    `SELECT id, booking_id, purpose, checklist, status, approved_by, threshold_pct::float8 AS threshold_pct
       FROM financial_clearance WHERE booking_id = $1 AND purpose = $2`,
    [bookingId, purpose]
  );
  if (existing.rows[0]) return existing.rows[0];

  const b = await db.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [bookingId]);
  if (!b.rows[0]) throw new AppError("not_found", "booking not found");
  const policy = await db.query<{ registration_min_pct: number }>(
    `SELECT registration_min_pct::float8 AS registration_min_pct FROM collection_policy WHERE project_id = $1`,
    [b.rows[0].project_id]
  );
  const thresholdPct = policy.rows[0]?.registration_min_pct ?? 0.7;

  const id = "fc_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO financial_clearance (id, booking_id, purpose, checklist, threshold_pct) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [id, bookingId, purpose, JSON.stringify(DEFAULT_CHECKLIST), thresholdPct]
  );
  return { id, booking_id: bookingId, purpose, checklist: DEFAULT_CHECKLIST, status: "PENDING", approved_by: null, threshold_pct: thresholdPct };
}

function checklistBlockers(checklist: ClearanceChecklist): string[] {
  const blockers: string[] = [];
  // Iterate DEFAULT_CHECKLIST's keys, not checklist's own — this is a gate, so a key missing
  // from the stored jsonb (e.g. an older row saved before a field was added) must fail closed
  // as blocking, not be silently skipped by Object.entries(checklist).
  for (const key of Object.keys(DEFAULT_CHECKLIST) as (keyof ClearanceChecklist)[]) {
    if (key === "bank_disbursement_applicable") continue; // a fact about the booking (loan involved or not), not a to-do item
    if (key === "bank_disbursement_received" && !checklist.bank_disbursement_applicable) continue; // "required iff applicable"
    if (!checklist[key]) blockers.push(key);
  }
  return blockers;
}

export async function getClearance(bookingId: string, purpose: ClearancePurpose, ctx: Ctx): Promise<ClearanceView> {
  requireRole(ctx, STAFF_ROLES);
  const row = await loadOrCreateRow(bookingId, purpose);
  const finance = await bookingFinance(bookingId);
  const blockers = checklistBlockers(row.checklist);
  if (finance.disputed > 0) blockers.push("unapproved_disputed_dues");
  if (finance.paid_pct + 1e-9 < row.threshold_pct) blockers.push("below_threshold");
  return { ...row, paid_pct: finance.paid_pct, blocked_reasons: row.status === "APPROVED" ? [] : blockers };
}

export async function updateClearanceChecklist(
  bookingId: string,
  purpose: ClearancePurpose,
  patch: Partial<ClearanceChecklist>,
  ctx: Ctx
): Promise<ClearanceView> {
  requireRole(ctx, STAFF_ROLES);
  const row = await loadOrCreateRow(bookingId, purpose);
  if (row.status === "APPROVED") throw new AppError("conflict", "clearance is immutable after approval");
  const merged: ClearanceChecklist = { ...row.checklist, ...patch };
  await db.query(`UPDATE financial_clearance SET checklist = $1::jsonb WHERE id = $2`, [JSON.stringify(merged), row.id]);
  return getClearance(bookingId, purpose, ctx);
}

/** Rule 9: "APPROVED only by Accounts lead/Management." STAFF_ROLES can view; only
 *  POLICY_STUDIO_ROLES-equivalent business-policy holders (MANAGEMENT/SUPER_ADMIN) plus ACCOUNTS
 *  itself (the lead role for this domain) may approve. */
const CLEARANCE_APPROVER_ROLES = [...POLICY_STUDIO_ROLES, "ACCOUNTS"];

export async function approveClearance(bookingId: string, purpose: ClearancePurpose, ctx: Ctx): Promise<ClearanceView> {
  requireRole(ctx, CLEARANCE_APPROVER_ROLES);
  // loadOrCreateRow/bookingFinance/listDemands all use the bare module-level `db` (finance.ts
  // has no tx-forwarding capability) — reading BEFORE opening the write transaction below avoids
  // the same-connection deadlock a nested `db.query` while `withTx`'s transaction is open would
  // cause (PGlite has one connection, no true nesting; other modules hit this exact class of bug).
  const row = await loadOrCreateRow(bookingId, purpose);
  if (row.status === "APPROVED") throw new AppError("conflict", "already approved (immutable)");
  const finance = await bookingFinance(bookingId);
  const blockers = checklistBlockers(row.checklist);
  if (finance.disputed > 0) blockers.push("unapproved_disputed_dues");
  if (finance.paid_pct + 1e-9 < row.threshold_pct) blockers.push("below_threshold");
  if (blockers.length > 0) {
    throw new AppError("conflict", `gate_blocked: ${blockers.join(", ")}`);
  }
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE financial_clearance SET status = 'APPROVED', approved_by = $1, approved_at = now() WHERE id = $2`, [ctx.actor.user_id, row.id]);
    await appendEvent(tx, {
      type: "clearance.approved",
      entity_type: "financial_clearance",
      entity_id: row.id,
      booking_id: bookingId,
      actor_user_id: ctx.actor.user_id,
      payload: { purpose, paid_pct: finance.paid_pct },
    });
  });
  return getClearance(bookingId, purpose, ctx); // outside the tx — this itself uses the bare db
}

export async function rejectClearance(bookingId: string, purpose: ClearancePurpose, reason: string, ctx: Ctx): Promise<ClearanceView> {
  requireRole(ctx, CLEARANCE_APPROVER_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  const row = await loadOrCreateRow(bookingId, purpose); // read before opening the write tx — see approveClearance
  if (row.status === "APPROVED") throw new AppError("conflict", "already approved (immutable)");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE financial_clearance SET status = 'REJECTED' WHERE id = $1`, [row.id]);
    await appendEvent(tx, {
      type: "clearance.rejected",
      entity_type: "financial_clearance",
      entity_id: row.id,
      booking_id: bookingId,
      actor_user_id: ctx.actor.user_id,
      payload: { purpose, reason },
    });
  });
  return getClearance(bookingId, purpose, ctx);
}
