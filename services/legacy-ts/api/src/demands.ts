import { randomUUID } from "node:crypto";
import { db } from "./db";
import { progressAtLeast, type ProgressState } from "./gates";
import { type DemandStatus } from "./collections";

// Accounts money handlers — H3 demand schedule, receipts, true-risk view (accounts/spec.md).
// Portable: no Express/AWS types.

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
  due_date: string;
  status: DemandStatus;
  overdue_reason_code: string | null;
  next_action: string | null;
  loan_dependent: boolean;
  has_active_ptp: boolean;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function asDate(value: string | Date): string {
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

async function mapDemands(sql: string, params: unknown[] = []): Promise<DemandRow[]> {
  const r = await db.query<DemandRow>(sql, params);
  return r.rows.map((row) => ({
    ...row,
    loan_dependent: Boolean(row.loan_dependent),
    has_active_ptp: Boolean(row.has_active_ptp),
  }));
}

export async function listDemands(bookingId: string) {
  return mapDemands(`${DEMAND_SELECT} WHERE d.booking_id = $1 ORDER BY d.sequence`, [bookingId]);
}

/** H3 — materialize the booking's payment plan as Demand rows. Idempotent. */
export async function setupFunding(bookingId: string) {
  const existing = await db.query(`SELECT 1 FROM demand WHERE booking_id = $1 LIMIT 1`, [bookingId]);
  if (existing.rows.length > 0) return listDemands(bookingId);

  const b = await db.query<{
    project_id: string;
    unit_id: string;
    total_consideration: number;
    payment_plan_id: string | null;
  }>(
    `SELECT project_id, unit_id, total_consideration::float8 AS total_consideration, payment_plan_id
       FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (b.rows.length === 0) throw new Error("not_found");
  const booking = b.rows[0];

  let planId = booking.payment_plan_id;
  if (!planId) {
    const plan = await db.query<{ id: string }>(
      `SELECT id FROM payment_plan WHERE project_id = $1 LIMIT 1`,
      [booking.project_id]
    );
    if (plan.rows.length === 0) throw new Error("payment_plan_missing");
    planId = plan.rows[0].id;
    await db.query(`UPDATE booking SET payment_plan_id = $1 WHERE id = $2`, [planId, bookingId]);
  }

  const ms = await db.query<{
    milestone_key: string;
    milestone_label: string;
    construction_trigger_event: string | null;
    sequence: number;
    pct_of_consideration: number;
  }>(
    `SELECT milestone_key, milestone_label, construction_trigger_event, sequence,
            pct_of_consideration::float8 AS pct_of_consideration
       FROM payment_plan_milestone WHERE plan_id = $1 ORDER BY sequence`,
    [planId]
  );

  const progress = await db.query<{ component_code: string; state_code: ProgressState }>(
    `SELECT component_code, state_code FROM unit_progress WHERE unit_id = $1`,
    [booking.unit_id]
  );
  const progressMap: Record<string, ProgressState> = {};
  for (const row of progress.rows) progressMap[row.component_code] = row.state_code;

  const consideration = booking.total_consideration;
  let allocated = 0;
  for (let i = 0; i < ms.rows.length; i++) {
    const m = ms.rows[i];
    const amount =
      i === ms.rows.length - 1
        ? consideration - allocated
        : Math.round((consideration * m.pct_of_consideration) / 100);
    allocated += amount;
    const status = initialStatus(m.construction_trigger_event, progressMap);
    await db.query(
      `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label,
        construction_trigger_event, sequence, amount, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        bookingId,
        booking.project_id,
        m.milestone_key,
        m.milestone_label,
        m.construction_trigger_event,
        m.sequence,
        amount,
        today(),
        status,
      ]
    );
  }
  return listDemands(bookingId);
}

function initialStatus(
  trigger: string | null,
  progress: Record<string, ProgressState>
): DemandStatus {
  if (!trigger) return "due";
  const [component, min] = trigger.split(":") as [string, ProgressState];
  const current = progress[component] ?? "not_started";
  return progressAtLeast(current, min) ? "due" : "scheduled";
}

/** Construction progress can make a scheduled demand due. */
export async function raiseDemandsForUnit(unitId: string) {
  const bookings = await db.query<{ id: string }>(
    `SELECT id FROM booking WHERE unit_id = $1 AND status = 'active'`,
    [unitId]
  );
  const progress = await db.query<{ component_code: string; state_code: ProgressState }>(
    `SELECT component_code, state_code FROM unit_progress WHERE unit_id = $1`,
    [unitId]
  );
  const progressMap: Record<string, ProgressState> = {};
  for (const row of progress.rows) progressMap[row.component_code] = row.state_code;

  for (const bk of bookings.rows) {
    const demands = await listDemands(bk.id);
    for (const d of demands) {
      if (d.status !== "scheduled" || !d.construction_trigger_event) continue;
      const [component, min] = d.construction_trigger_event.split(":") as [string, ProgressState];
      const current = progressMap[component] ?? "not_started";
      if (progressAtLeast(current, min)) {
        await db.query(`UPDATE demand SET status = 'due', due_date = $1 WHERE id = $2`, [
          today(),
          d.id,
        ]);
      }
    }
  }
}

export async function postReceipt(
  demandId: string,
  input: { amount: number; mode?: string; idempotency_key?: string }
) {
  const key = input.idempotency_key ?? randomUUID();
  const hash = JSON.stringify({ amount: input.amount, mode: input.mode ?? "neft" });
  const existing = await db.query<{ id: string; request_hash: string }>(
    `SELECT id, request_hash FROM receipt WHERE idempotency_key = $1`,
    [key]
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].request_hash !== hash) throw new Error("idempotency_payload_mismatch");
    const r = await db.query(`SELECT * FROM receipt WHERE id = $1`, [existing.rows[0].id]);
    return { ...r.rows[0], amount: Number((r.rows[0] as { amount: number }).amount) };
  }

  const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
  if (!d) throw new Error("not_found");
  if (input.amount <= 0) throw new Error("invalid_amount");
  if (input.amount > d.remaining) throw new Error("exceeds_remaining");

  const id = randomUUID();
  await db.query(
    `INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, mode, status, idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,'reconciled',$7,$8)`,
    [id, d.booking_id, d.project_id, demandId, input.amount, input.mode ?? "neft", key, hash]
  );
  const remaining = d.remaining - input.amount;
  const status: DemandStatus = remaining <= 0 ? "settled" : "part_paid";
  await db.query(`UPDATE demand SET status = $1 WHERE id = $2`, [status, demandId]);
  const row = await db.query(`SELECT * FROM receipt WHERE id = $1`, [id]);
  return { ...row.rows[0], amount: input.amount, project_id: d.project_id };
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
