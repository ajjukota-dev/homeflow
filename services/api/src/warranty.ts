import { randomUUID } from "node:crypto";
import { db } from "./db";
import { appendEvent, withTx, actorFields } from "./events";
import { authorize } from "./authz/authorize";
import type { Ctx } from "./authz/types";

// H12 consumer — DLP, passport, check-ins, service history (post-handover/spec.md).
// Durations come from handover_policy, never a hard-coded East Crest month count.

interface DlpWindowRow {
  id: string;
  unit_id: string;
  booking_id: string;
  dlp_start: Date;
  dlp_end: Date;
  status: string;
  policy_months: number;
  unit_number: string;
  customer_name: string | null;
}

interface WarrantyCaseRow {
  id: string;
  unit_id: string;
  booking_id: string;
  project_id: string;
  passport_item_id: string | null;
  category: string;
  trade: string;
  severity: string;
  description: string;
  coverage: string;
  status: string;
  chargeable_amount: string;
  root_cause_code: string | null;
  unit_number: string;
  customer_name: string | null;
}

interface CheckinRow {
  id: string;
  booking_id: string;
  day: number;
  status: string;
  satisfaction_score: number | null;
  unit_number: string;
  customer_name: string | null;
}

interface ServiceHistoryRow {
  id: string;
  unit_id: string;
  event_type: string;
  description: string;
  actor: string;
  occurred_at: Date;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function onHandoverCompleted(bookingId: string) {
  const b = await db.query<{ unit_id: string; project_id: string }>(
    `SELECT unit_id, project_id FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (b.rows.length === 0) throw new Error("booking_not_found");
  const { unit_id, project_id } = b.rows[0];
  const existing = await db.query(`SELECT id FROM dlp_window WHERE booking_id = $1`, [bookingId]);
  if (existing.rows.length > 0) return projectWarranty(project_id);

  const pol = await db.query<{ dlp_months: number; checkin_days: string }>(
    `SELECT dlp_months, checkin_days FROM handover_policy WHERE project_id = $1`,
    [project_id]
  );
  const months = pol.rows[0]?.dlp_months ?? 12;
  const start = new Date().toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO dlp_window (id, unit_id, booking_id, project_id, dlp_start, dlp_end, status, policy_months)
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`,
    [randomUUID(), unit_id, bookingId, project_id, start, addMonths(start, months), months]
  );

  const items = await db.query(`SELECT id FROM home_passport_item WHERE unit_id = $1`, [unit_id]);
  if (items.rows.length === 0) {
    await db.query(
      `INSERT INTO home_passport_item (id, unit_id, project_id, category, name, brand_model, warranty_months)
       VALUES ($1,$2,$3,'appliance','Split AC','1.5 ton inverter',12),
              ($4,$2,$3,'appliance','Water heater','25 litre',24)`,
      [randomUUID(), unit_id, project_id, randomUUID()]
    );
  }

  const days = (pol.rows[0]?.checkin_days ?? "7,30,90").split(",").map((d) => Number(d.trim()));
  for (const day of days) {
    await db.query(`INSERT INTO checkin_record (id, booking_id, day, status) VALUES ($1,$2,$3,'scheduled')`, [
      randomUUID(),
      bookingId,
      day,
    ]);
  }
  await db.query(
    `INSERT INTO service_history (id, unit_id, event_type, description, actor)
     VALUES ($1,$2,'handover.completed','Keys issued and Home Passport handed over','QA / RM')`,
    [randomUUID(), unit_id]
  );
  return projectWarranty(project_id);
}

// `ctx` optional: also called internally by onHandoverCompleted (post-handover DLP
// setup), which is itself reached only from qa.ts's completeHandover (already gated).
export async function projectWarranty(projectId: string, ctx?: Ctx) {
  if (ctx) await authorize(ctx, "handovers", "READ");
  const windows = await db.query<DlpWindowRow>(
    `SELECT d.id, d.unit_id, d.booking_id, d.dlp_start, d.dlp_end, d.status, d.policy_months,
            u.unit_number, a.display_name AS customer_name
       FROM dlp_window d
       JOIN unit u ON u.id = d.unit_id
       JOIN booking b ON b.id = d.booking_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE d.project_id = $1 ORDER BY u.unit_number`,
    [projectId]
  );
  const cases = await db.query<WarrantyCaseRow>(
    `SELECT w.*, u.unit_number, a.display_name AS customer_name
       FROM warranty_case w
       JOIN unit u ON u.id = w.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = w.booking_id AND a.role = 'primary'
      WHERE w.project_id = $1 ORDER BY w.status, u.unit_number`,
    [projectId]
  );
  const checkins = await db.query<CheckinRow>(
    `SELECT c.id, c.booking_id, c.day, c.status, c.satisfaction_score, u.unit_number,
            a.display_name AS customer_name
       FROM checkin_record c
       JOIN booking b ON b.id = c.booking_id
       JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.project_id = $1 ORDER BY c.day`,
    [projectId]
  );
  return { windows: windows.rows, cases: cases.rows, checkins: checkins.rows };
}

export async function serviceHistory(unitId: string, ctx: Ctx) {
  await authorize(ctx, "handovers", "READ");
  const r = await db.query<ServiceHistoryRow>(
    `SELECT id, unit_id, event_type, description, actor, occurred_at
       FROM service_history WHERE unit_id = $1 ORDER BY occurred_at`,
    [unitId]
  );
  return r.rows;
}

/** Emits warranty.case_closed (02 Appendix B). */
export async function closeWarranty(id: string, ctx: Ctx) {
  await authorize(ctx, "handovers", "WRITE");
  const w = await db.query<{ unit_id: string; project_id: string; coverage: string; description: string }>(
    `SELECT unit_id, project_id, coverage, description FROM warranty_case WHERE id = $1`,
    [id]
  );
  if (w.rows.length === 0) throw new Error("not_found");
  const chargeable = w.rows[0].coverage === "out_of_coverage";
  await withTx(undefined, async (t) => {
    await t.query(`UPDATE warranty_case SET status = 'closed', chargeable_amount = $2 WHERE id = $1`, [
      id,
      chargeable ? 1 : 0,
    ]);
    await t.query(
      `INSERT INTO service_history (id, unit_id, event_type, warranty_case_id, description, actor)
       VALUES ($1,$2,'warranty.case.resolved',$3,$4,'service')`,
      [randomUUID(), w.rows[0].unit_id, id, `Closed: ${w.rows[0].description}`]
    );
    await appendEvent(t, {
      type: "warranty.case_closed",
      entity_type: "warranty_case",
      entity_id: id,
      project_id: w.rows[0].project_id,
      unit_id: w.rows[0].unit_id,
      payload: { chargeable_amount: chargeable ? 1 : 0 },
      ...actorFields(ctx),
    });
  });
  return db
    .query<{ id: string; unit_id: string; status: string; chargeable_amount: string }>(
      `SELECT * FROM warranty_case WHERE id = $1`,
      [id]
    )
    .then((r) => r.rows[0]);
}

/** Emits checkin.captured (extension — check-ins aren't named in Appendix B). */
export async function captureCheckin(id: string, satisfactionScore: number, ctx: Ctx) {
  await authorize(ctx, "handovers", "WRITE");
  const existing = await db.query<{ id: string; booking_id: string }>(
    `SELECT id, booking_id FROM checkin_record WHERE id = $1`,
    [id]
  );
  if (existing.rows.length === 0) throw new Error("not_found");
  if (!Number.isInteger(satisfactionScore) || satisfactionScore < 1 || satisfactionScore > 5) {
    const err = new Error("validation_failed") as Error & {
      errors: { code: string; field: string; message: string }[];
    };
    err.errors = [{ code: "validation", field: "satisfaction_score", message: "must be an integer from 1 to 5" }];
    throw err;
  }
  const bk = await db.query<{ project_id: string; unit_id: string }>(
    `SELECT project_id, unit_id FROM booking WHERE id = $1`,
    [existing.rows[0].booking_id]
  );
  await withTx(undefined, async (t) => {
    await t.query(
      `UPDATE checkin_record SET status = 'captured', satisfaction_score = $2, captured_at = now() WHERE id = $1`,
      [id, satisfactionScore]
    );
    await appendEvent(t, {
      type: "checkin.captured",
      entity_type: "checkin_record",
      entity_id: id,
      project_id: bk.rows[0]?.project_id ?? null,
      booking_id: existing.rows[0].booking_id,
      unit_id: bk.rows[0]?.unit_id ?? null,
      payload: { satisfaction_score: satisfactionScore },
      ...actorFields(ctx),
    });
  });
  return db
    .query<{ id: string; booking_id: string; day: number; status: string; satisfaction_score: number | null }>(
      `SELECT * FROM checkin_record WHERE id = $1`,
      [id]
    )
    .then((r) => r.rows[0]);
}
