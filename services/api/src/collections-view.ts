import { db } from "./db";
import {
  classifyOpenAmount,
  daysOverdue,
  recoveryProbability,
  whyNow,
  RISK_BUCKETS,
  type DemandStatus,
  type RiskBucket,
} from "./collections";
import { asDate, DEMAND_SELECT, listDemands, today, type DemandRow } from "./demands";

// Workbench + T2 projections over the demand ledger (accounts/spec.md §2.3 / T2).

export interface CollectionItem {
  demand_id: string;
  booking_id: string;
  customer_name: string;
  unit_number: string;
  milestone_label: string;
  amount: number;
  ageing_days: number;
  overdue_reason_code: string | null;
  next_action: string | null;
  bucket: RiskBucket;
}

export async function projectCollections(projectId: string, asOf = today()) {
  const policy = await db.query<{ true_risk_max_probability: number }>(
    `SELECT true_risk_max_probability::float8 AS true_risk_max_probability
       FROM collection_policy WHERE project_id = $1`,
    [projectId]
  );
  const threshold = policy.rows[0]?.true_risk_max_probability ?? 0.4;

  const rows = await db.query<DemandRow & { customer_name: string; unit_number: string }>(
    `SELECT x.*, a.display_name AS customer_name, u.unit_number
       FROM (${DEMAND_SELECT}) x
       JOIN booking b ON b.id = x.booking_id
       JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE x.project_id = $1`,
    [projectId]
  );

  const buckets = Object.fromEntries(
    RISK_BUCKETS.map((k) => [k, { amount: 0, items: [] as CollectionItem[] }])
  ) as Record<RiskBucket, { amount: number; items: CollectionItem[] }>;

  let outstanding_total = 0;
  for (const row of rows.rows) {
    const remaining = Number(row.remaining);
    // A scheduled demand's due_date is null; classifyOpenAmount already excludes
    // "scheduled" from every bucket, and daysOverdue/isPastDue treat a null date as
    // not-yet-due rather than crashing — so an un-triggered demand never appears here,
    // and a demand that somehow left "scheduled" without a date (e.g. an early receipt)
    // still surfaces its balance in DUE instead of silently disappearing.
    const dueDate = asDate(row.due_date);
    const ageing = daysOverdue(dueDate, asOf);
    const bucket = classifyOpenAmount({
      remaining,
      status: row.status,
      due_date: dueDate,
      as_of: asOf,
      loan_dependent: Boolean(row.loan_dependent),
      has_active_ptp: Boolean(row.has_active_ptp),
      recovery_probability: recoveryProbability(ageing),
      true_risk_threshold: threshold,
    });
    if (!bucket) continue;
    outstanding_total += remaining;
    buckets[bucket].amount += remaining;
    buckets[bucket].items.push({
      demand_id: row.id,
      booking_id: row.booking_id,
      customer_name: row.customer_name,
      unit_number: row.unit_number,
      milestone_label: row.milestone_label,
      amount: remaining,
      ageing_days: ageing,
      overdue_reason_code: row.overdue_reason_code,
      next_action: row.next_action,
      bucket,
    });
  }
  return { outstanding_total, buckets };
}

export async function listOverdueReasons() {
  const r = await db.query<{ code: string; label: string; next_action: string }>(
    `SELECT code, label, next_action FROM overdue_reason ORDER BY label`
  );
  return r.rows;
}

export async function t2Payments(bookingId: string) {
  const b = await db.query<{ total_consideration: number }>(
    `SELECT total_consideration::float8 AS total_consideration FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (b.rows.length === 0) return null;
  const demands = await listDemands(bookingId);
  const receipts = await db.query<{ id: string; amount: number; received_at: string }>(
    `SELECT id, amount::float8 AS amount, received_at::text AS received_at
       FROM receipt WHERE booking_id = $1 AND status IN ('posted','reconciled')
       ORDER BY received_at`,
    [bookingId]
  );
  const paid_total = receipts.rows.reduce((s, r) => s + Number(r.amount), 0);
  const customerStatus = (status: DemandStatus) => {
    if (status === "settled") return "Paid";
    if (status === "waived") return "Waived";
    if (status === "scheduled") return "Upcoming";
    return "Due";
  };
  const next = demands.find((d) => d.status !== "settled" && d.status !== "waived");
  return {
    schedule: demands.map((d) => ({
      milestone_label: d.milestone_label,
      amount: d.amount,
      due_date: asDate(d.due_date),
      status: customerStatus(d.status),
      why_now: whyNow({
        milestone_label: d.milestone_label,
        construction_trigger_event: d.construction_trigger_event,
        status: d.status,
      }),
    })),
    paid_total,
    remaining_total: b.rows[0].total_consideration - paid_total,
    receipts: receipts.rows.map((r) => ({
      receipt_id: r.id,
      amount: Number(r.amount),
      date: asDate(r.received_at),
    })),
    next_due: next
      ? { milestone_label: next.milestone_label, amount: next.remaining, due_date: asDate(next.due_date) }
      : null,
  };
}
