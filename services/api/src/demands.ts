import { randomUUID } from "node:crypto";
import { db } from "./db";
import { type DemandStatus } from "./collections";
import type { DbLike } from "./events";

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
  next_action: string | null;
  loan_dependent: boolean;
  has_active_ptp: boolean;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
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
            WHERE r.demand_id = d.id AND r.status IN ('posted','reconciled')
         ), 0))::float8 AS remaining,
         d.due_date::text AS due_date, d.status, d.overdue_reason_code,
         o.next_action, d.loan_dependent,
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

export async function listDemands(bookingId: string, handle: DbLike = db) {
  return mapDemands(`${DEMAND_SELECT} WHERE d.booking_id = $1 ORDER BY d.sequence`, [bookingId], handle);
}

export async function setOverdueReason(demandId: string, reasonCode: string) {
  const ok = await db.query(`SELECT next_action FROM overdue_reason WHERE code = $1`, [reasonCode]);
  if (ok.rows.length === 0) throw new Error("unknown_reason");
  await db.query(`UPDATE demand SET overdue_reason_code = $1 WHERE id = $2`, [reasonCode, demandId]);
  return (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
}

export async function recordPtp(
  demandId: string,
  input: { expected_date: string; expected_amount: number }
) {
  const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
  if (!d) throw new Error("not_found");
  await db.query(
    `INSERT INTO promise_to_pay (id, demand_id, expected_date, expected_amount) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), demandId, input.expected_date, input.expected_amount]
  );
  return (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
}
