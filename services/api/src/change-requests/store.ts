import { db } from "../db";
import { AppError, type Ctx } from "../authz/types";
import type { DbLike } from "../events";

// 18-change-requests.md — shared row shapes + loaders, split out to avoid the same import-cycle
// shape 22's store.ts already broke: capture.ts/costing.ts/approvals.ts/quotation.ts/release.ts
// all need CrRow, and several of them need each other's exports.

export type CrStatus =
  | "DRAFT" | "REQUESTED" | "FEASIBILITY_REVIEW" | "COSTING" | "AWAITING_APPROVAL" | "AWAITING_CUSTOMER"
  | "AWAITING_PAYMENT" | "APPROVED" | "RELEASED" | "IN_PROGRESS" | "READY_FOR_QA" | "QA_VERIFIED"
  | "CUSTOMER_ACCEPTED" | "AS_BUILT_CLOSED" | "REJECTED" | "WITHDRAWN" | "CANCELLED";

export interface FeasibilityInfo { result: "FEASIBLE" | "FEASIBLE_WITH_CONDITIONS" | "NOT_FEASIBLE"; technical_notes: string; reviewer: string | null; at: string }
export interface ImpactInfo { cost_inr: number; schedule_days: number; technical_risk: "LOW" | "MEDIUM" | "HIGH"; handover_impact: "NONE" | "DELAYS_HANDOVER" | "BLOCKS_HANDOVER"; notes: string }

export interface CrRow {
  id: string; code: string; booking_id: string; unit_id: string; project_id: string; customer_id: string | null;
  raised_by_kind: "CUSTOMER_PORTAL" | "SALES" | "CRM" | "CUSTOMISATION"; raised_by_user_id: string | null;
  status: CrStatus; title: string; summary: string | null; primary_category_code: string | null;
  freeze_state_at_request: "PRE_FREEZE" | "POST_FREEZE"; gate_summary_at_request: Record<string, string>;
  exception_id: string | null; feasibility: FeasibilityInfo | null; impact: ImpactInfo | null;
  quotation_id: string | null; payment_gate: "REQUIRED" | "WAIVED" | null; payment_waiver_authority: string | null;
  payment_demand_id: string | null; released_at: string | null; released_by: string | null;
  spec_revision_id: string | null; qa_inspection_id: string | null; customer_accepted_at: string | null;
  as_built_closed_at: string | null; cancel_reason: string | null; abortive_cost_inr: number | null; owner_user_id: string | null;
  created_at: string; updated_at: string;
}

export const CR_SELECT = `SELECT id, code, booking_id, unit_id, project_id, customer_id, raised_by_kind, raised_by_user_id, status, title, summary, primary_category_code,
  freeze_state_at_request, gate_summary_at_request, exception_id, feasibility, impact, quotation_id, payment_gate, payment_waiver_authority,
  payment_demand_id, released_at::text AS released_at, released_by, spec_revision_id, qa_inspection_id, customer_accepted_at::text AS customer_accepted_at,
  as_built_closed_at::text AS as_built_closed_at, cancel_reason, abortive_cost_inr::float8 AS abortive_cost_inr, owner_user_id,
  created_at::text AS created_at, updated_at::text AS updated_at FROM change_request`;

export async function loadCr(id: string, tx: DbLike = db): Promise<CrRow> {
  const r = await tx.query<CrRow>(`${CR_SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "change request not found");
  return r.rows[0];
}

export interface CrItemRow {
  id: string; cr_id: string; room: string | null; trade: string | null; category_code: string; catalogue_item_id: string | null;
  description: string; qty: number; unit_price_inr: number; vendor_cost_inr: number; tax_pct: number; lead_days: number;
  gate_state_at_request: string | null; status: "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "REVERSED"; created_at: string;
}
export const CR_ITEM_SELECT = `SELECT id, cr_id, room, trade, category_code, catalogue_item_id, description, qty::float8 AS qty,
  unit_price_inr::float8 AS unit_price_inr, vendor_cost_inr::float8 AS vendor_cost_inr, tax_pct::float8 AS tax_pct, lead_days,
  gate_state_at_request, status, created_at::text AS created_at FROM change_request_item`;

export async function listCrItems(crId: string, tx: DbLike = db): Promise<CrItemRow[]> {
  return (await tx.query<CrItemRow>(`${CR_ITEM_SELECT} WHERE cr_id = $1 ORDER BY created_at`, [crId])).rows;
}

export interface QuotationRow {
  id: string; cr_id: string; version: number; lines: { item_id: string; description: string; qty: number; unit_price_inr: number; tax_pct: number; line_total_inr: number }[];
  subtotal_inr: number; tax_inr: number; waiver_inr: number; total_inr: number; valid_until: string; issued_at: string; issued_by: string | null;
  status: "DRAFT" | "ISSUED" | "ACCEPTED" | "EXPIRED" | "SUPERSEDED" | "DECLINED"; pdf_file_key: string | null; document_id: string | null;
  customer_accepted_at: string | null; accepted_via: "PORTAL" | "SIGNED_COPY" | null;
}
export const QUOTATION_SELECT = `SELECT id, cr_id, version, lines, subtotal_inr::float8 AS subtotal_inr, tax_inr::float8 AS tax_inr,
  waiver_inr::float8 AS waiver_inr, total_inr::float8 AS total_inr, valid_until::text AS valid_until, issued_at::text AS issued_at, issued_by,
  status, pdf_file_key, document_id, customer_accepted_at::text AS customer_accepted_at, accepted_via FROM quotation`;

export async function loadQuotation(id: string, tx: DbLike = db): Promise<QuotationRow> {
  const r = await tx.query<QuotationRow>(`${QUOTATION_SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "quotation not found");
  return r.rows[0];
}

/** Customers may only act on their own CR (via `customer_login`'s user_id -> booking_id, same
 *  lookup as `customer.ts::bookingForCustomerUser`); staff need the CUSTOMISATION-desk role set
 *  (same `ctx.actor.kind` split as qa/snags.ts::reopenSnag). */
export async function assertCrActor(cr: CrRow, ctx: Ctx, staffRoles: string[], tx: DbLike = db): Promise<void> {
  if (ctx.actor.kind === "CUSTOMER") {
    const r = await tx.query<{ booking_id: string }>(`SELECT booking_id FROM customer_login WHERE user_id = $1`, [ctx.actor.user_id]);
    if (r.rows[0]?.booking_id !== cr.booking_id) throw new AppError("forbidden", "customers may act only on their own change request");
    return;
  }
  if (!ctx.actor.roles.some((r) => staffRoles.includes(r))) throw new AppError("forbidden", `requires one of: ${staffRoles.join(", ")}`);
}

export interface PolicyRow { freeze_dates: Record<string, string>; quotation_validity_days: number; payment_gate_pct: number; cancellation_terms: Record<string, unknown>; allowed_catalogue_only: boolean }

export async function loadPolicy(projectId: string, tx: DbLike = db): Promise<PolicyRow> {
  const r = await tx.query<PolicyRow>(`SELECT freeze_dates, quotation_validity_days, payment_gate_pct::float8 AS payment_gate_pct, cancellation_terms, allowed_catalogue_only FROM customisation_policy WHERE project_id = $1`, [projectId]);
  return r.rows[0] ?? { freeze_dates: {}, quotation_validity_days: 15, payment_gate_pct: 100, cancellation_terms: {}, allowed_catalogue_only: false };
}
