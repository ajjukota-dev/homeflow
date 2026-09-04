import { randomUUID } from "node:crypto";
import { db } from "./db";
import { progressAtLeast, type ProgressState } from "./gates";
import { type DemandStatus } from "./collections";
import { listDemands, today } from "./demands";

// H3 — booking payment-plan materialization and construction-progress-driven demand release (accounts/spec.md).

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
    // Only a demand whose trigger has already fired gets a date; a scheduled demand
    // is dated later by raiseDemandsForUnit, when its trigger actually fires.
    const dueDate = status === "scheduled" ? null : today();
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
        dueDate,
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
