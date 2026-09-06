// 27-management-control-tower.md rule 6 — profitability, explainable per row via `economic_event`.
// Derivation is idempotent (one row per source fact, upserted by `economic_event_source_idx`),
// same "derive, never hand-type" discipline as 20's forecast_line — callable directly since no
// scheduler exists anywhere in this codebase (06/12/19/20/21's own already-documented gap).
//
// Two of the Data table's 7 kinds have no real producer and are left unwired, flagged not faked:
// COST_TO_SERVE (no labour/time-tracking exists anywhere to attribute a per-unit service cost)
// and — unlike the other six — ABORTIVE_COST DOES have a real source (`change_request.
// abortive_cost_inr`, set by `cancelChangeRequest`) and is wired below.

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { withTx, appendEvent, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import type { Ctx } from "../authz/types";

interface Fact { source_id: string; booking_id: string | null; unit_id: string | null; amount_inr: number; reason: string | null }

// Returns whether any fact was newly inserted or had its amount/reason actually change — deriving
// is called on every GET (rule 6), so an unconditional append would grow the immutable event log
// on every read even when nothing about the underlying facts moved.
async function upsert(tx: DbLike, projectId: string, kind: string, sourceType: string, facts: Fact[]): Promise<boolean> {
  let changed = false;
  for (const f of facts) {
    const r = await tx.query(
      `INSERT INTO economic_event (id, project_id, booking_id, unit_id, kind, amount_inr, source_type, source_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (kind, source_type, source_id) DO UPDATE SET amount_inr = $6, reason = $9, occurred_at = now()
       WHERE economic_event.amount_inr IS DISTINCT FROM $6 OR economic_event.reason IS DISTINCT FROM $9
       RETURNING id`,
      [randomUUID(), projectId, f.booking_id, f.unit_id, kind, f.amount_inr, sourceType, f.source_id, f.reason]
    );
    if (r.rows.length > 0) changed = true;
  }
  return changed;
}

/** Rule 6's derivation pass — one project at a time, safe to call repeatedly (upsert, not insert). */
export async function deriveEconomicEvents(projectId: string): Promise<void> {
  await withTx(undefined, async (tx) => {
    // COMMERCIAL_LEAKAGE / SERVICE_LEAKAGE — 19's approved waivers. PRINCIPAL/INTEREST read as a
    // commercial (pricing) concession; LATE_FEE/OTHER_CHARGE read as a service-recovery goodwill
    // waiver — a judgment-call split (19 doesn't itself label waivers this way), same class as
    // 15/18's other vocabulary-mapping calls this run.
    const waivers = await tx.query<{ id: string; booking_id: string; amount: number; reason: string; kind: string }>(
      `SELECT w.id, w.booking_id, w.amount::float8 AS amount, w.reason, w.kind FROM waiver w
         JOIN booking b ON b.id = w.booking_id WHERE b.project_id = $1 AND w.status = 'APPROVED'`,
      [projectId]
    );
    let changed = false;
    const commercial = waivers.rows.filter((w) => w.kind === "PRINCIPAL" || w.kind === "INTEREST");
    const service = waivers.rows.filter((w) => w.kind === "LATE_FEE" || w.kind === "OTHER_CHARGE");
    changed = (await upsert(tx, projectId, "COMMERCIAL_LEAKAGE", "waiver", commercial.map((w) => ({ source_id: w.id, booking_id: w.booking_id, unit_id: null, amount_inr: w.amount, reason: w.reason })))) || changed;
    changed = (await upsert(tx, projectId, "SERVICE_LEAKAGE", "waiver", service.map((w) => ({ source_id: w.id, booking_id: w.booking_id, unit_id: null, amount_inr: w.amount, reason: w.reason })))) || changed;

    // QUALITY_COST — 15's snag costs (actual if verified, else the estimate).
    const snags = await tx.query<{ id: string; booking_id: string | null; unit_id: string; cost: number; description: string }>(
      `SELECT id, booking_id, unit_id, COALESCE(actual_cost_inr, estimated_cost_inr)::float8 AS cost, description
         FROM snag WHERE project_id = $1 AND COALESCE(actual_cost_inr, estimated_cost_inr) IS NOT NULL`,
      [projectId]
    );
    changed = (await upsert(tx, projectId, "QUALITY_COST", "snag", snags.rows.map((s) => ({ source_id: s.id, booking_id: s.booking_id, unit_id: s.unit_id, amount_inr: s.cost, reason: s.description })))) || changed;

    // DELAY_COST — 13's own breach detection substitutes for 06's not-yet-modeled slippage (06's
    // own Build note: planned/forecast/actual stay in sync, no variance engine wired yet) — a
    // TIMELINE commitment breach IS a real, dated delay with a ₹/day config to price it.
    const cfg = await tx.query<{ value: number }>(`SELECT (value #>> '{}')::float8 AS value FROM management_config WHERE key = 'delay_cost_per_day_inr'`);
    const perDay = cfg.rows[0]?.value ?? 0;
    const breaches = await tx.query<{ id: string; booking_id: string; unit_id: string; due_date: string; breached_at: string; description: string }>(
      `SELECT id, booking_id, unit_id, due_date::text AS due_date, breached_at::text AS breached_at, description
         FROM commitment WHERE project_id = $1 AND category = 'TIMELINE' AND status = 'BREACHED' AND breached_at IS NOT NULL AND due_date IS NOT NULL`,
      [projectId]
    );
    changed = (await upsert(
      tx, projectId, "DELAY_COST", "commitment",
      breaches.rows.map((b) => {
        const days = Math.max(0, Math.round((Date.parse(b.breached_at) - Date.parse(b.due_date)) / 86400000));
        return { source_id: b.id, booking_id: b.booking_id, unit_id: b.unit_id, amount_inr: days * perDay, reason: `${days}d late — ${b.description}` };
      })
    )) || changed;

    // VARIATION_CONTRIBUTION — 18's accepted quotations: revenue − vendor cost − tax, per CR.
    const crs = await tx.query<{ id: string; booking_id: string; unit_id: string; contribution: number }>(
      `SELECT cr.id, cr.booking_id, cr.unit_id,
              (COALESCE((SELECT SUM(qty * (unit_price_inr - vendor_cost_inr)) FROM change_request_item WHERE cr_id = cr.id), 0)
               - COALESCE((SELECT tax_inr FROM quotation WHERE id = cr.quotation_id), 0))::float8 AS contribution
         FROM change_request cr
        WHERE cr.project_id = $1 AND cr.status IN ('RELEASED', 'IN_PROGRESS', 'READY_FOR_QA', 'QA_VERIFIED', 'CUSTOMER_ACCEPTED', 'AS_BUILT_CLOSED')`,
      [projectId]
    );
    changed = (await upsert(tx, projectId, "VARIATION_CONTRIBUTION", "change_request", crs.rows.map((c) => ({ source_id: c.id, booking_id: c.booking_id, unit_id: c.unit_id, amount_inr: c.contribution, reason: null })))) || changed;

    // ABORTIVE_COST — a cancelled CR's own recorded sunk cost (cancellation.ts's own input).
    const aborted = await tx.query<{ id: string; booking_id: string; unit_id: string; cost: number; reason: string | null }>(
      `SELECT id, booking_id, unit_id, abortive_cost_inr::float8 AS cost, cancel_reason AS reason
         FROM change_request WHERE project_id = $1 AND status = 'CANCELLED' AND abortive_cost_inr > 0`,
      [projectId]
    );
    changed = (await upsert(tx, projectId, "ABORTIVE_COST", "change_request", aborted.rows.map((a) => ({ source_id: a.id, booking_id: a.booking_id, unit_id: a.unit_id, amount_inr: a.cost, reason: a.reason })))) || changed;

    if (changed) {
      await appendEvent(tx, { type: "economic_event.recorded", entity_type: "project", entity_id: projectId, project_id: projectId, payload: { count: commercial.length + service.length + snags.rows.length + breaches.rows.length + crs.rows.length + aborted.rows.length } });
    }
  });
}

export interface ProfitabilityRow { kind: string; unit_id: string | null; booking_id: string | null; amount_inr: number; reason: string | null; occurred_at: string }

/** GET /profitability?project_id — derives fresh, then reads. Per-project totals by kind plus
 *  the per-unit contribution table rule 6 asks for. */
export async function getProfitability(projectId: string, ctx: Ctx) {
  await authorize(ctx, "reports", "READ");
  await deriveEconomicEvents(projectId);
  const rows = await db.query<ProfitabilityRow>(
    `SELECT kind, unit_id, booking_id, amount_inr::float8 AS amount_inr, reason, occurred_at::text AS occurred_at
       FROM economic_event WHERE project_id = $1 ORDER BY kind, occurred_at DESC`,
    [projectId]
  );
  const byKind: Record<string, number> = {};
  for (const r of rows.rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + r.amount_inr;
  const byUnit = await db.query<{ unit_id: string; contribution: number; leakage: number; quality_cost: number }>(
    `SELECT unit_id,
            COALESCE(SUM(amount_inr) FILTER (WHERE kind = 'VARIATION_CONTRIBUTION'), 0)::float8 AS contribution,
            COALESCE(SUM(amount_inr) FILTER (WHERE kind IN ('COMMERCIAL_LEAKAGE', 'SERVICE_LEAKAGE')), 0)::float8 AS leakage,
            COALESCE(SUM(amount_inr) FILTER (WHERE kind = 'QUALITY_COST'), 0)::float8 AS quality_cost
       FROM economic_event WHERE project_id = $1 AND unit_id IS NOT NULL GROUP BY unit_id`,
    [projectId]
  );
  return { totals_by_kind: byKind, rows: rows.rows, per_unit: byUnit.rows };
}
