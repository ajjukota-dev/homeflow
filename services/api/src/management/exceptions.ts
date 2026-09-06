// 27-management-control-tower.md rule 5 (p34 §30.2) — every row names its own source, so the
// view can link straight to it. No numeric "high-value" threshold is given anywhere in the spec
// set for gate exceptions (UNCONFIRMED, same class as 12/20's other un-numbered thresholds) — all
// ACTIVE exceptions are listed rather than silently applying an invented cutoff.

import { db } from "../db";
import { authorize } from "../authz/authorize";
import type { Ctx } from "../authz/types";

export interface ExceptionRow {
  kind: string; id: string; unit_id: string | null; booking_id: string | null; owner: string | null; headline: string; occurred_at: string;
}

export async function getExceptions(projectId: string, ctx: Ctx, kind?: string): Promise<ExceptionRow[]> {
  await authorize(ctx, "reports", "READ");
  const out: ExceptionRow[] = [];

  if (!kind || kind === "STALE_GATE") {
    const r = await db.query<{ unit_id: string; category_code: string; last_evaluated_at: string }>(
      `SELECT ucg.unit_id, ucg.category_code, ucg.last_evaluated_at::text AS last_evaluated_at
         FROM unit_change_gate ucg JOIN unit u ON u.id = ucg.unit_id
        WHERE u.project_id = $1 AND ucg.freshness_status = 'VERIFICATION_REQUIRED'`,
      [projectId]
    );
    out.push(...r.rows.map((x) => ({ kind: "STALE_GATE", id: `${x.unit_id}:${x.category_code}`, unit_id: x.unit_id, booking_id: null, owner: "SITE", headline: `${x.category_code} gate needs re-verification`, occurred_at: x.last_evaluated_at })));
  }

  if (!kind || kind === "GATE_EXCEPTION") {
    const r = await db.query<{ id: string; unit_id: string; category_code: string; granted_by: string | null; created_at: string }>(
      `SELECT uge.id, uge.unit_id, uge.category_code, u2.display_name AS granted_by, uge.created_at::text AS created_at
         FROM unit_gate_exception uge JOIN unit u ON u.id = uge.unit_id
         LEFT JOIN "user" u2 ON u2.id = uge.granted_by
        WHERE u.project_id = $1 AND uge.status = 'ACTIVE'`,
      [projectId]
    );
    out.push(...r.rows.map((x) => ({ kind: "GATE_EXCEPTION", id: x.id, unit_id: x.unit_id, booking_id: null, owner: x.granted_by, headline: `${x.category_code} exception granted`, occurred_at: x.created_at })));
  }

  if (!kind || kind === "ACTIVE_HOLD") {
    const r = await db.query<{ id: string; unit_id: string; booking_id: string | null; requested_by: string | null; created_at: string }>(
      `SELECT h.id, h.unit_id, h.booking_id, u2.display_name AS requested_by, h.requested_until::text AS created_at
         FROM change_window_hold h LEFT JOIN "user" u2 ON u2.id = h.requested_by
        WHERE h.project_id = $1 AND h.status = 'APPROVED' AND h.approved_until >= CURRENT_DATE`,
      [projectId]
    );
    out.push(...r.rows.map((x) => ({ kind: "ACTIVE_HOLD", id: x.id, unit_id: x.unit_id, booking_id: x.booking_id, owner: x.requested_by, headline: "Active hold affecting schedule", occurred_at: x.created_at })));
  }

  if (!kind || kind === "CR_POST_FREEZE_OR_WAIVED") {
    const r = await db.query<{ id: string; unit_id: string; booking_id: string; freeze_state_at_request: string; payment_gate: string | null; created_at: string }>(
      `SELECT id, unit_id, booking_id, freeze_state_at_request, payment_gate, created_at::text AS created_at
         FROM change_request WHERE project_id = $1 AND status NOT IN ('DRAFT', 'REQUESTED', 'REJECTED', 'WITHDRAWN', 'CANCELLED')
          AND (freeze_state_at_request = 'POST_FREEZE' OR payment_gate = 'WAIVED')`,
      [projectId]
    );
    out.push(...r.rows.map((x) => ({ kind: "CR_POST_FREEZE_OR_WAIVED", id: x.id, unit_id: x.unit_id, booking_id: x.booking_id, owner: "CUSTOMISATION", headline: x.payment_gate === "WAIVED" ? "Released via payment waiver" : "Approved post-freeze", occurred_at: x.created_at })));
  }

  if (!kind || kind === "CR_NEGATIVE_CONTRIBUTION") {
    const r = await db.query<{ id: string; unit_id: string; booking_id: string; contribution: number; created_at: string }>(
      `SELECT cr.id, cr.unit_id, cr.booking_id,
              (COALESCE((SELECT SUM(qty * (unit_price_inr - vendor_cost_inr)) FROM change_request_item WHERE cr_id = cr.id), 0)
               - COALESCE((SELECT tax_inr FROM quotation WHERE id = cr.quotation_id), 0))::float8 AS contribution,
              cr.created_at::text AS created_at
         FROM change_request cr WHERE cr.project_id = $1 AND cr.status <> 'DRAFT'`,
      [projectId]
    );
    out.push(...r.rows.filter((x) => x.contribution < 0).map((x) => ({ kind: "CR_NEGATIVE_CONTRIBUTION", id: x.id, unit_id: x.unit_id, booking_id: x.booking_id, owner: "CUSTOMISATION", headline: `Negative contribution ₹${x.contribution.toLocaleString("en-IN")}`, occurred_at: x.created_at })));
  }

  if (!kind || kind === "HANDOVER_OVERRIDE") {
    const r = await db.query<{ id: string; case_id: string; gate: string; authority_role: string; created_at: string }>(
      `SELECT ho.id, ho.case_id, ho.gate, ho.authority_role, ho.created_at::text AS created_at
         FROM handover_override ho JOIN handover_record hr ON hr.id = ho.case_id WHERE hr.project_id = $1`,
      [projectId]
    );
    out.push(...r.rows.map((x) => ({ kind: "HANDOVER_OVERRIDE", id: x.id, unit_id: null, booking_id: x.case_id, owner: x.authority_role, headline: `${x.gate} gate overridden`, occurred_at: x.created_at })));
  }

  if (!kind || kind === "FORECAST_MANUAL_OVERRIDE") {
    const r = await db.query<{ id: string; booking_id: string; amount_inr: number; created_at: string }>(
      `SELECT id, booking_id, amount_inr::float8 AS amount_inr, expected_date::text AS created_at
         FROM forecast_line WHERE project_id = $1 AND source_type = 'MANUAL_FINANCE_OVERRIDE' AND status = 'ACTIVE'`,
      [projectId]
    );
    out.push(...r.rows.map((x) => ({ kind: "FORECAST_MANUAL_OVERRIDE", id: x.id, unit_id: null, booking_id: x.booking_id, owner: "ACCOUNTS", headline: `Manual forecast override ₹${x.amount_inr.toLocaleString("en-IN")}`, occurred_at: x.created_at })));
  }

  return out;
}
