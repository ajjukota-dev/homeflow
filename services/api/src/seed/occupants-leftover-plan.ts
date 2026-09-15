import { db } from "../db";
import { createPlanRevision } from "../journey/plan-revision";
import { asDateStr } from "../journey/calendar";
import { management } from "./occupants-ctx";

// 2.12: shift planned_end via createPlanRevision on existing journeys so plan ≠ baseline.
// Catalog delay_reason only — no invented SOP durations (one calendar day past the live planned_end).

function nextDay(iso: string): string {
  const d = new Date(`${asDateStr(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function reviseIfNeeded(bookingId: string, reasonCode: string): Promise<void> {
  const existing = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM timeline_plan_revision r
       JOIN journey_instance j ON j.id = r.journey_id
      WHERE j.booking_id = $1`,
    [bookingId]
  );
  if ((existing.rows[0]?.n ?? 0) > 0) return;
  const journey = await db.query<{ id: string }>(`SELECT id FROM journey_instance WHERE booking_id = $1`, [bookingId]);
  if (!journey.rows[0]) throw new Error(`seed 2.12: no journey for ${bookingId}`);
  const stage = await db.query<{ stage_code: string; planned_start: string | Date; planned_end: string | Date }>(
    `SELECT stage_code, planned_start, planned_end FROM stage_instance WHERE journey_id = $1 ORDER BY planned_end DESC LIMIT 1`,
    [journey.rows[0].id]
  );
  if (!stage.rows[0]) throw new Error(`seed 2.12: no stage on ${bookingId}`);
  const start = asDateStr(stage.rows[0].planned_start);
  const end = nextDay(asDateStr(stage.rows[0].planned_end));
  await createPlanRevision(
    journey.rows[0].id,
    { changes: [{ stage_code: stage.rows[0].stage_code, new_planned_start: start, new_planned_end: end }], reason_code: reasonCode, note: "Demo plan revision (catalog reason, not SOP days)" },
    management
  );
}

export async function seedPlanVsForecast(): Promise<void> {
  await reviseIfNeeded("b_v110", "INTERNAL_RESEQUENCE");
  await reviseIfNeeded("b_mt201", "CUSTOMER_CHANGE");
}
