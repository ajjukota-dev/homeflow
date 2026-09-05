import { db } from "../db";
import { AppError, type Ctx } from "../authz/types";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { withTx, appendEvent, actorFields } from "../events";
import { computeReadiness, allHardOk } from "./readiness";
import { loadOrCreateCase, loadCaseByBooking, loadTemplate, toDbRegStatus, type RegCaseRow, type Readiness } from "./store";

// 23-registration.md. Writers: Registration, Legal, Management (rule 7); CRM may confirm
// availability on the customer's behalf (rule 2) — the portal (26) half of that rule isn't
// built, same fallback-flagging pattern as 18's signed-copy quotation acceptance.
export const REGISTRATION_ROLES = ["REGISTRATION", "LEGAL", "MANAGEMENT", "SUPER_ADMIN"];
export const AVAILABILITY_ROLES = [...REGISTRATION_ROLES, "CRM"];

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Rule 1's live readiness recompute, plus rule 4's forecast — run on every read and every
 *  write so nothing downstream ever trusts a stale stored value. Status only ever advances
 *  through the readiness ladder (not_ready -> readiness_in_progress -> ready) here; once a case
 *  reaches availability_confirmed/slot_booked/executed/completed this never regresses it — gate
 *  points (bookSlot/recordExecution/completeCase) re-check the live facts themselves instead,
 *  same "derive from real facts at the gate" discipline 19's collections sweep already used. */
async function refresh(row: RegCaseRow, ctx: Ctx, tx = db): Promise<RegCaseRow> {
  const readiness = await computeReadiness(row, ctx, tx);
  const template = await loadTemplate(row.project_id, tx);
  const leadDays = template?.jurisdiction_lead_days ?? 15;

  let base: Date;
  let confidence: "LOW" | "MEDIUM" | "HIGH";
  if (row.slot_datetime) {
    base = new Date(row.slot_datetime);
    confidence = "HIGH";
  } else if (row.proposed_availability_dates?.length) {
    base = new Date(row.proposed_availability_dates[0]!);
    confidence = allHardOk(readiness) ? "MEDIUM" : "LOW";
  } else {
    base = addDays(new Date(), allHardOk(readiness) ? 7 : 21);
    confidence = "LOW";
  }
  const forecastDate = addDays(base, leadDays).toISOString().slice(0, 10);

  let nextStatus = row.status;
  if (["NOT_READY", "READINESS_IN_PROGRESS", "READY"].includes(row.status)) {
    // tds/poa_valid can both be trivially true with zero action taken (below-threshold
    // consideration, no POA applicant) — only the facts that require a real staff/customer
    // action count as "progress" for the NOT_READY -> READINESS_IN_PROGRESS distinction.
    const anyProgress = readiness.documents.ok || readiness.clearance.ok || readiness.agreement_executed.ok || readiness.sale_deed_ready.ok || readiness.signatories.ok;
    nextStatus = allHardOk(readiness) ? "READY" : anyProgress ? "READINESS_IN_PROGRESS" : "NOT_READY";
  }

  const changed = JSON.stringify(readiness) !== JSON.stringify(row.readiness) || nextStatus !== row.status || forecastDate !== row.forecast_date || confidence !== row.forecast_confidence;
  if (!changed) return row;

  await withTx(tx === db ? undefined : tx, async (t) => {
    await t.query(
      `UPDATE registration_case SET readiness = $1::jsonb, status = $2, forecast_date = $3, forecast_confidence = $4 WHERE id = $5`,
      [JSON.stringify(readiness), toDbRegStatus(nextStatus), forecastDate, confidence, row.id]
    );
    if (nextStatus !== row.status) {
      await appendEvent(t, {
        type: "registration.readiness_changed",
        entity_type: "registration_case",
        entity_id: row.id,
        project_id: row.project_id,
        booking_id: row.booking_id,
        unit_id: row.unit_id,
        payload: { from: row.status, to: nextStatus, readiness },
        ...actorFields(ctx),
      });
    }
  });

  return { ...row, readiness, status: nextStatus, forecast_date: forecastDate, forecast_confidence: confidence };
}

export async function getRegistrationCase(bookingId: string, ctx: Ctx): Promise<RegCaseRow> {
  requireRole(ctx, STAFF_ROLES);
  const row = await loadOrCreateCase(bookingId);
  return refresh(row, ctx);
}

export async function listRegistrationPipeline(projectId: string, ctx: Ctx): Promise<RegCaseRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const rows = await db.query<{ booking_id: string }>(`SELECT booking_id FROM registration_case WHERE project_id = $1 ORDER BY created_at`, [projectId]);
  const out: RegCaseRow[] = [];
  for (const r of rows.rows) out.push(await getRegistrationCase(r.booking_id, ctx));
  return out;
}

/** Rule 2: "via customer action (portal or CRM on behalf) proposing dates." */
export async function confirmAvailability(bookingId: string, dates: string[], ctx: Ctx): Promise<RegCaseRow> {
  requireRole(ctx, AVAILABILITY_ROLES);
  if (!dates?.length) throw new AppError("validation", "at least one proposed date is required", "dates");
  let row = await loadOrCreateCase(bookingId);
  row = await refresh(row, ctx);
  if (row.status !== "READY" && row.status !== "AVAILABILITY_CONFIRMED") {
    throw new AppError("conflict", `gate_blocked: case is ${row.status}, not READY`);
  }
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE registration_case SET proposed_availability_dates = $1::jsonb, status = 'availability_confirmed' WHERE id = $2`, [JSON.stringify(dates), row.id]);
    await appendEvent(tx, {
      type: "registration.availability_confirmed",
      entity_type: "registration_case",
      entity_id: row.id,
      project_id: row.project_id,
      booking_id: bookingId,
      unit_id: row.unit_id,
      payload: { dates },
      ...actorFields(ctx),
    });
  });
  return getRegistrationCase(bookingId, ctx);
}

/** Rule 2: "SLOT_BOOKED requires READY + confirmed availability... every slot change appends to
 *  slot_history with reason." Rule 6 (raise the ON_REGISTRATION final demand here) is NOT wired:
 *  it needs 20's forecast_line / a payment_plan ON_REGISTRATION milestone flag, neither of which
 *  exists — flagged, not faked, same as 18's rule 12. The ">3 days from availability ->
 *  escalation [E §11.1]" half is surfaced as a fact on the return value only; no real Escalation
 *  row is raised (12's scanEscalations is config-rule-driven, not a per-call trigger — wiring a
 *  new escalation_rule kind for this is separate scope, same class as 15's unwired
 *  critical_snag_2d). */
export async function bookSlot(bookingId: string, input: { sro_office: string; slot_datetime: string; reference: string }, ctx: Ctx): Promise<RegCaseRow & { escalation_needed: boolean }> {
  requireRole(ctx, REGISTRATION_ROLES);
  let row = await loadOrCreateCase(bookingId);
  row = await refresh(row, ctx);
  if (!allHardOk(row.readiness)) throw new AppError("conflict", "gate_blocked: readiness not met");
  if (!row.proposed_availability_dates?.length) throw new AppError("conflict", "gate_blocked: no confirmed customer availability");

  const nearest = row.proposed_availability_dates.map((d) => Math.abs(new Date(d).getTime() - new Date(input.slot_datetime).getTime())).sort((a, b) => a - b)[0]!;
  const escalationNeeded = nearest > 3 * 24 * 60 * 60 * 1000;

  await withTx(undefined, async (tx) => {
    const history = [...row.slot_history, { from: null, to: input.slot_datetime, reason: "initial booking", by: ctx.actor.user_id, at: new Date().toISOString() }];
    await tx.query(
      `UPDATE registration_case SET sro_office = $1, slot_datetime = $2, slot_reference = $3, slot_history = $4::jsonb, status = 'slot_booked' WHERE id = $5`,
      [input.sro_office, input.slot_datetime, input.reference, JSON.stringify(history), row.id]
    );
    await appendEvent(tx, {
      type: "registration.scheduled",
      entity_type: "registration_case",
      entity_id: row.id,
      project_id: row.project_id,
      booking_id: bookingId,
      unit_id: row.unit_id,
      payload: { sro_office: input.sro_office, slot_datetime: input.slot_datetime, reference: input.reference, escalation_needed: escalationNeeded },
      ...actorFields(ctx),
    });
  });
  const updated = await getRegistrationCase(bookingId, ctx);
  return { ...updated, escalation_needed: escalationNeeded };
}

export async function rescheduleSlot(bookingId: string, input: { slot_datetime: string; reason: string }, ctx: Ctx): Promise<RegCaseRow> {
  requireRole(ctx, REGISTRATION_ROLES);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  const row = await loadCaseByBooking(bookingId);
  if (row.status !== "SLOT_BOOKED") throw new AppError("conflict", `gate_blocked: case is ${row.status}, not SLOT_BOOKED`);
  await withTx(undefined, async (tx) => {
    const history = [...row.slot_history, { from: row.slot_datetime, to: input.slot_datetime, reason: input.reason, by: ctx.actor.user_id, at: new Date().toISOString() }];
    await tx.query(`UPDATE registration_case SET slot_datetime = $1, slot_history = $2::jsonb WHERE id = $3`, [input.slot_datetime, JSON.stringify(history), row.id]);
    await appendEvent(tx, {
      type: "registration.rescheduled",
      entity_type: "registration_case",
      entity_id: row.id,
      project_id: row.project_id,
      booking_id: bookingId,
      unit_id: row.unit_id,
      payload: { from: row.slot_datetime, to: input.slot_datetime, reason: input.reason },
      ...actorFields(ctx),
    });
  });
  return getRegistrationCase(bookingId, ctx);
}

export async function updateDayOfChecklist(bookingId: string, patch: Record<string, boolean>, ctx: Ctx): Promise<RegCaseRow> {
  requireRole(ctx, REGISTRATION_ROLES);
  const row = await loadCaseByBooking(bookingId);
  const merged = { ...row.day_of_checklist, ...patch };
  await db.query(`UPDATE registration_case SET day_of_checklist = $1::jsonb WHERE id = $2`, [JSON.stringify(merged), row.id]);
  return getRegistrationCase(bookingId, ctx);
}

/** Rule 5: "day-of checklist must be complete before EXECUTED can be recorded." */
export async function recordExecution(
  bookingId: string,
  input: { executed_on: string; registration_document_number?: string; company_representative?: string; customer_attendees?: Record<string, unknown>[]; stamp_duty_inr?: number; registration_fee_inr?: number; outcome_notes?: string },
  ctx: Ctx
): Promise<RegCaseRow> {
  requireRole(ctx, REGISTRATION_ROLES);
  const row = await loadCaseByBooking(bookingId);
  if (row.status !== "SLOT_BOOKED") throw new AppError("conflict", `gate_blocked: case is ${row.status}, not SLOT_BOOKED`);
  const template = await loadTemplate(row.project_id);
  const requiredKeys = (template?.day_of_items ?? []).map((i) => i.key);
  const incomplete = requiredKeys.filter((k) => !row.day_of_checklist[k]);
  if (incomplete.length > 0) throw new AppError("conflict", `gate_blocked: day-of checklist incomplete: ${incomplete.join(", ")}`);

  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE registration_case SET status = 'executed', executed_on = $1, registration_document_number = $2, company_representative = $3,
         customer_attendees = $4::jsonb, stamp_duty_inr = $5, registration_fee_inr = $6, outcome_notes = $7 WHERE id = $8`,
      [input.executed_on, input.registration_document_number ?? null, input.company_representative ?? null, JSON.stringify(input.customer_attendees ?? []), input.stamp_duty_inr ?? null, input.registration_fee_inr ?? null, input.outcome_notes ?? null, row.id]
    );
    await appendEvent(tx, {
      type: "registration.executed",
      entity_type: "registration_case",
      entity_id: row.id,
      project_id: row.project_id,
      booking_id: bookingId,
      unit_id: row.unit_id,
      payload: { executed_on: input.executed_on },
      ...actorFields(ctx),
    });
  });
  return getRegistrationCase(bookingId, ctx);
}

/** Rule 3: coexists with legal-docs.ts's own pre-existing `completeRegistration` (the AOS-era
 *  simple flow) rather than replacing it — both write the same `registration_case` row and the
 *  same terminal `status = 'completed'` value the pre-existing readers (qa.ts,
 *  scores/booking-readiness.ts) already key on, and both emit the one already-`built:true`
 *  `registration.completed` event. A case that goes through this rich pipeline never calls the
 *  legacy function; the `already completed` guard below stops either path double-firing the
 *  side effects if both were somehow invoked on the same booking. */
export async function completeCase(bookingId: string, input: { deed_document_id: string; sro_reference: string }, ctx: Ctx): Promise<RegCaseRow> {
  requireRole(ctx, REGISTRATION_ROLES);
  const row = await loadCaseByBooking(bookingId);
  if (row.status === "COMPLETED") throw new AppError("conflict", "already completed");
  if (row.status !== "EXECUTED") throw new AppError("conflict", `gate_blocked: case is ${row.status}, not EXECUTED`);
  if (!row.registration_document_number) throw new AppError("conflict", "gate_blocked: registration_document_number not recorded");
  const deed = await db.query<{ family_code: string; status: string }>(`SELECT family_code, status FROM doc_factory_document WHERE id = $1`, [input.deed_document_id]);
  if (!deed.rows[0]) throw new AppError("not_found", "deed document not found");
  if (deed.rows[0].family_code !== "SALE_DEED") throw new AppError("validation", "deed_document_id must be a SALE_DEED document", "deed_document_id");
  if (!["FINAL", "ARCHIVED"].includes(deed.rows[0].status)) throw new AppError("conflict", `gate_blocked: sale deed is ${deed.rows[0].status}, not FINAL`);

  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE registration_case SET status = 'completed', registered_deed_file_id = $1, sro_reference = $2, completed_at = now() WHERE id = $3`,
      [input.deed_document_id, input.sro_reference, row.id]
    );
    await tx.query(`UPDATE booking SET status = 'registered' WHERE id = $1 AND status <> 'handed_over'`, [bookingId]);
    await tx.query(`UPDATE unit SET sale_status = 'registered' WHERE id = $1 AND sale_status <> 'handed_over'`, [row.unit_id]);
    await appendEvent(tx, {
      type: "registration.completed",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: row.project_id,
      booking_id: bookingId,
      unit_id: row.unit_id,
      payload: { sro_reference: input.sro_reference, registration_document_number: row.registration_document_number },
      ...actorFields(ctx),
    });
  });
  return getRegistrationCase(bookingId, ctx);
}
