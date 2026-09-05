import { randomUUID } from "node:crypto";
import { db } from "./db";
import { clock } from "./ports/clock";
import { type DemandStatus } from "./collections";
import { appendEvent, withTx, actorFields, type DbLike } from "./events";
import { createAction } from "./actions/core";
import { authorize } from "./authz/authorize";
import type { Ctx } from "./authz/types";

// Accounts money handlers — H3 demand rows, overdue reasons, PTP (accounts/spec.md).
// Portable: no Express/AWS types. Schedule creation lives in demands-schedule.ts, receipt posting in demands-receipts.ts.

export interface DemandRow {
  id: string;
  booking_id: string;
  project_id: string;
  milestone_key: string;
  milestone_label: string;
  construction_trigger_event: string | null;
  sequence: number;
  amount: number;
  remaining: number;
  due_date: string | null; // null until the construction trigger fires (H3)
  status: DemandStatus;
  overdue_reason_code: string | null;
  next_action: string | null; // overdue_reason.next_action — human-readable label, unchanged
  next_action_id: string | null; // 19-collections-true-risk.md rule 2 — the real Action row id
  reason_note: string | null;
  dispute_reason: string | null;
  tax_amount: number;
  loan_dependent: boolean;
  has_active_ptp: boolean;
}

// Was UTC (`new Date().toISOString().slice(0,10)`) — fixed to IST via the
// clock port (03-platform-deploy.md); callers/signature unchanged.
export function today(): string {
  return clock.todayIst();
}

export function asDate(value: string | Date): string;
export function asDate(value: string | Date | null): string | null;
export function asDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export const DEMAND_SELECT = `
  SELECT d.id, d.booking_id, d.project_id, d.milestone_key, d.milestone_label,
         d.construction_trigger_event, d.sequence, d.amount::float8 AS amount,
         (d.amount - COALESCE((
           SELECT SUM(r.amount) FROM receipt r
            WHERE r.demand_id = d.id AND r.status IN ('posted','reconciled') AND r.verification != 'DISPUTED'
         ), 0) - COALESCE((
           SELECT SUM(w.amount) FROM waiver w
            WHERE w.demand_id = d.id AND w.status = 'APPROVED'
         ), 0))::float8 AS remaining,
         d.due_date::text AS due_date, d.status, d.overdue_reason_code,
         o.next_action, d.next_action_id, d.reason_note, d.dispute_reason,
         d.tax_amount::float8 AS tax_amount, d.loan_dependent,
         EXISTS (
           SELECT 1 FROM promise_to_pay p
            WHERE p.demand_id = d.id AND p.converted_receipt_id IS NULL
         ) AS has_active_ptp
    FROM demand d
    LEFT JOIN overdue_reason o ON o.code = d.overdue_reason_code
`;

// `handle` defaults to the module-level `db`; pass the active `tx` when called from inside
// a withTx callback — a bare `db.query` while a transaction is open on the same PGlite
// instance deadlocks (single connection/mutex), it does not run as a separate session.
export async function mapDemands(sql: string, params: unknown[] = [], handle: DbLike = db): Promise<DemandRow[]> {
  const r = await handle.query<DemandRow>(sql, params);
  return r.rows.map((row) => ({
    ...row,
    loan_dependent: Boolean(row.loan_dependent),
    has_active_ptp: Boolean(row.has_active_ptp),
  }));
}

// `ctx` is only supplied at the route entry point (GET /api/bookings/:id/demands) —
// internal reentrant callers (t2Payments, postReceipt) skip it; their own outer
// handler already authorized before reaching here.
export async function listDemands(bookingId: string, handle: DbLike = db, ctx?: Ctx) {
  if (ctx) await authorize(ctx, "collections", "READ");
  return mapDemands(`${DEMAND_SELECT} WHERE d.booking_id = $1 ORDER BY d.sequence`, [bookingId], handle);
}

// Rule 2 (19-collections-true-risk.md): "next_action_id always set from the reason's default."
// When the recorded reason carries a default_action_type (19-collections-true-risk.md's
// overdue_reason.default_action_type), this creates that follow-up Action (10) and points
// next_action_id at it — the real Action row, not just the reason's descriptive text
// (overdue_reason.next_action, unchanged, still returned separately).
export async function setOverdueReason(demandId: string, reasonCode: string, ctx: Ctx, note?: string) {
  await authorize(ctx, "collections", "WRITE");
  const reason = await db.query<{ default_action_type: string | null }>(
    `SELECT default_action_type FROM overdue_reason WHERE code = $1`,
    [reasonCode]
  );
  if (reason.rows.length === 0) throw new Error("unknown_reason");
  const defaultType = reason.rows[0].default_action_type;

  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE demand SET overdue_reason_code = $1, reason_note = $2 WHERE id = $3`, [reasonCode, note ?? null, demandId]);
    const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId], tx))[0];
    if (!d) throw new Error("not_found");

    let actionId: string | null = null;
    if (defaultType) {
      actionId = await createAction(
        {
          type: defaultType,
          title: `Follow up — ${d.milestone_label}`,
          project_id: d.project_id,
          source_module: "collections",
          source_entity_type: "demand",
          source_entity_id: demandId,
          booking_id: d.booking_id,
          owner_role: "ACCOUNTS",
          priority: "MEDIUM",
          origin: "AUTO",
        },
        tx
      );
      await tx.query(`UPDATE demand SET next_action_id = $1 WHERE id = $2`, [actionId, demandId]);
    }

    await appendEvent(tx, {
      type: "demand.reason_recorded",
      entity_type: "demand",
      entity_id: demandId,
      project_id: d.project_id,
      booking_id: d.booking_id,
      payload: { reason_code: reasonCode, action_id: actionId },
      ...actorFields(ctx),
    });
  });

  return (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
}

export async function recordPtp(
  demandId: string,
  input: { expected_date: string; expected_amount: number },
  ctx: Ctx
) {
  await authorize(ctx, "collections", "WRITE");
  const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
  if (!d) throw new Error("not_found");
  await db.query(
    `INSERT INTO promise_to_pay (id, demand_id, expected_date, expected_amount) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), demandId, input.expected_date, input.expected_amount]
  );
  return (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
}
