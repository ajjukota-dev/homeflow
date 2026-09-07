import { randomUUID } from "node:crypto";
import { db } from "../db";
import { AppError, type Ctx } from "../authz/types";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { withTx, appendEvent, actorFields } from "../events";
import { createAction } from "../actions/core";
import { onHandoverCompleted } from "../warranty";
import { evaluateCase, type CaseView } from "./gates";
import { loadOrCreateCase, loadCaseByBooking, loadGateConfig, GATE_DB_TO_TYPE, type HoCaseRow } from "./store";

// 16-handover-gates.md. Writers: QA/Handover role for case work; Management for the pipeline +
// override log (Screens). Per-gate override eligibility is config-driven (override_roles),
// checked separately in overrideGate below — this allow-list is the case-mutation floor.
export const HANDOVER_ROLES = ["QA", "FM", "MANAGEMENT", "SUPER_ADMIN"];

/** 26's own rule 1: a customer may only act on their own booking — same pattern as
 *  `registration/core.ts::assertOwnBooking` (inlined per-module, not shared: each call site
 *  checks a slightly different condition, per that module's own comment). */
async function assertOwnBooking(ctx: Ctx, bookingId: string): Promise<void> {
  const r = await db.query<{ booking_id: string }>(`SELECT booking_id FROM customer_login WHERE user_id = $1`, [ctx.actor.user_id]);
  if (r.rows[0]?.booking_id !== bookingId) throw new AppError("forbidden", "customers may act only on their own booking");
}

interface ChecklistRow { groups: Record<string, Record<string, unknown>>; customer_signature_file_id: string | null; company_signature_file_id: string | null; photos: string[] }
interface AppointmentRow { proposed_slots: string[]; confirmed_slot: string | null; confirmed_by: string | null; confirmed_at: string | null; attendees: Record<string, unknown>[]; rescheduled_count: number; reschedule_reasons: { reason: string; at: string }[] }

// 16's own Data row (verbatim, "seed [E §10.3]") — every item defaults to {done:false, by:null,
// at:null, file_ids:[]} until QA/FM ticks it. Which of these are "required" for rule 5's
// completion gate isn't stated by the spec beyond keys.all_handed_over and the two signatures
// (already enforced in completeCase below) — flagged, not guessed, rather than blanket-requiring
// every item here.
const CHECKLIST_GROUP_ITEMS: Record<string, string[]> = {
  property: ["cleaning", "electrical", "plumbing", "fixtures", "doors_windows", "snag_clearance"],
  keys: ["main_door_count", "secondary_count", "utility_count", "other_count", "all_handed_over"],
  access: ["access_cards_count", "parking_slot_ids", "clubhouse_confirmed", "security_briefed"],
  utilities: ["electricity_meter_no", "electricity_reading", "water_meter_no", "water_reading", "gas"],
  documents: ["possession_letter", "warranties", "manuals", "registration_copy", "maintenance_docs", "contact_directory"],
};
function checklistSkeleton(): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = {};
  for (const [group, items] of Object.entries(CHECKLIST_GROUP_ITEMS)) {
    groups[group] = {};
    for (const item of items) groups[group][item] = { done: false, by: null, at: null, file_ids: [] };
  }
  return groups;
}

async function loadChecklist(caseId: string): Promise<ChecklistRow> {
  const r = await db.query<ChecklistRow>(`SELECT groups, customer_signature_file_id, company_signature_file_id, photos FROM handover_checklist WHERE case_id = $1`, [caseId]);
  if (!r.rows[0]) return { groups: checklistSkeleton(), customer_signature_file_id: null, company_signature_file_id: null, photos: [] };
  const stored = r.rows[0];
  const skeleton = checklistSkeleton();
  const groups: Record<string, Record<string, unknown>> = {};
  for (const group of Object.keys(skeleton)) groups[group] = { ...skeleton[group], ...(stored.groups[group] ?? {}) };
  return { ...stored, groups };
}
async function loadAppointment(caseId: string): Promise<AppointmentRow | null> {
  const r = await db.query<AppointmentRow>(`SELECT proposed_slots, confirmed_slot::text AS confirmed_slot, confirmed_by, confirmed_at::text AS confirmed_at, attendees, rescheduled_count, reschedule_reasons FROM handover_appointment WHERE case_id = $1`, [caseId]);
  return r.rows[0] ?? null;
}

export interface HandoverView extends CaseView {
  checklist: ChecklistRow;
  appointment: AppointmentRow | null;
}

async function buildHandoverView(bookingId: string): Promise<HandoverView> {
  const view = await evaluateCase(bookingId);
  const [checklist, appointment] = await Promise.all([loadChecklist(view.case.id), loadAppointment(view.case.id)]);
  return { ...view, checklist, appointment };
}

export async function getHandoverCase(bookingId: string, ctx: Ctx): Promise<HandoverView> {
  requireRole(ctx, STAFF_ROLES);
  return buildHandoverView(bookingId);
}

/** `POST /handover/:id/evaluate` — rule 7's "on demand" half. Every other read (GET the case,
 *  any mutation) also re-evaluates internally (rule 7's "on every input event" half) but doesn't
 *  emit `handover.gate_evaluated` each time — that would flood the event log on every page load.
 *  This is the one explicit, user-triggered evaluation that logs. */
export async function evaluateAndLog(bookingId: string, ctx: Ctx): Promise<HandoverView> {
  const view = await getHandoverCase(bookingId, ctx);
  await appendEvent(db, {
    type: "handover.gate_evaluated",
    entity_type: "handover_record",
    entity_id: view.case.id,
    project_id: view.case.project_id,
    booking_id: bookingId,
    unit_id: view.case.unit_id,
    payload: { eligible: view.eligible, lifecycle: view.lifecycle },
    ...actorFields(ctx),
  });
  return view;
}

/** Every active booking in the project, not just ones a case row already exists for —
 *  `getHandoverCase` -> `evaluateCase` -> `loadOrCreateCase` lazily creates the row on first
 *  touch, same as the legacy `qa.ts::projectHandover` this replaces, which iterated all active
 *  bookings rather than pre-existing `handover_record` rows. Found live: querying
 *  `handover_record` directly silently dropped every villa nobody had opened a case for yet. */
export async function listHandoverPipeline(projectId: string, ctx: Ctx): Promise<HandoverView[]> {
  requireRole(ctx, STAFF_ROLES);
  const rows = await db.query<{ id: string }>(`SELECT id FROM booking WHERE project_id = $1 AND status = 'active' ORDER BY created_at`, [projectId]);
  const out: HandoverView[] = [];
  for (const r of rows.rows) out.push(await getHandoverCase(r.id, ctx));
  return out;
}

/** Rule 4: "CRM proposes >=2 slots after all HARD gates pass (or are overridden)." */
export async function proposeAppointment(bookingId: string, slots: string[], ctx: Ctx): Promise<HandoverView> {
  requireRole(ctx, [...HANDOVER_ROLES, "CRM"]);
  if (!slots || slots.length < 2) throw new AppError("validation", "at least 2 proposed slots are required", "slots");
  const view = await evaluateCase(bookingId);
  if (!view.eligible) throw new AppError("conflict", "gate_blocked: hard gates are not all PASSED or OVERRIDDEN");
  await db.query(
    `INSERT INTO handover_appointment (case_id, proposed_slots) VALUES ($1,$2::jsonb)
     ON CONFLICT (case_id) DO UPDATE SET proposed_slots = $2::jsonb`,
    [view.case.id, JSON.stringify(slots)]
  );
  return getHandoverCase(bookingId, ctx);
}

/** Rule 4: "customer confirms in the portal or CRM confirms on behalf with a note." Flips the
 *  CUSTOMER gate (handover.ts's customer gate already always passes — this table is what the
 *  gate SHOULD read once portal (26) exists; not yet wired back into evaluateHandover's input,
 *  same flag-don't-fake gap 23 left for its own portal fallback). Also moves the case to
 *  SCHEDULED and emits `handover.scheduled` once (guarded on the prior status). */
export async function confirmAppointment(
  bookingId: string,
  input: { slot: string; confirmed_by: "CUSTOMER_PORTAL" | "CRM_ON_BEHALF"; note?: string; attendees?: Record<string, unknown>[] },
  ctx: Ctx
): Promise<HandoverView> {
  if (ctx.actor.kind === "CUSTOMER") {
    await assertOwnBooking(ctx, bookingId);
    if (input.confirmed_by !== "CUSTOMER_PORTAL") throw new AppError("forbidden", "customers may only confirm as CUSTOMER_PORTAL");
  } else {
    requireRole(ctx, [...HANDOVER_ROLES, "CRM"]);
  }
  if (input.confirmed_by === "CRM_ON_BEHALF" && !input.note?.trim()) throw new AppError("validation", "note is required for CRM_ON_BEHALF confirmation", "note");
  const view = await evaluateCase(bookingId);
  const appt = await loadAppointment(view.case.id);
  if (!appt?.proposed_slots?.length) throw new AppError("conflict", "gate_blocked: no proposed slots to confirm");
  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE handover_appointment SET confirmed_slot = $1, confirmed_by = $2, confirmed_at = now(), attendees = $3::jsonb WHERE case_id = $4`,
      [input.slot, input.confirmed_by, JSON.stringify(input.attendees ?? []), view.case.id]
    );
    await appendEvent(tx, {
      type: "handover.appointment_confirmed",
      entity_type: "handover_record",
      entity_id: view.case.id,
      project_id: view.case.project_id,
      booking_id: bookingId,
      unit_id: view.case.unit_id,
      payload: { slot: input.slot, confirmed_by: input.confirmed_by },
      ...actorFields(ctx),
    });
    if (view.case.status !== "SCHEDULED" && view.case.status !== "COMPLETED" && view.case.status !== "CLOSED") {
      await tx.query(`UPDATE handover_record SET status = 'scheduled' WHERE id = $1`, [view.case.id]);
      await appendEvent(tx, {
        type: "handover.scheduled",
        entity_type: "handover_record",
        entity_id: view.case.id,
        project_id: view.case.project_id,
        booking_id: bookingId,
        unit_id: view.case.unit_id,
        payload: { slot: input.slot },
        ...actorFields(ctx),
      });
    }
  });
  return buildHandoverView(bookingId);
}

/** Rule 4: "reschedule requires reason and recreates the customer action (10)." The action-type
 *  used here (`handover_appointment_reschedule`) must exist in action_type — seeded by
 *  seed/handover-gates.ts, same convention as every other createAction caller in this codebase. */
export async function rescheduleAppointment(bookingId: string, input: { slot: string; reason: string }, ctx: Ctx): Promise<HandoverView> {
  if (ctx.actor.kind === "CUSTOMER") await assertOwnBooking(ctx, bookingId);
  else requireRole(ctx, [...HANDOVER_ROLES, "CRM"]);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  const view = await evaluateCase(bookingId);
  const appt = await loadAppointment(view.case.id);
  if (!appt) throw new AppError("conflict", "gate_blocked: no appointment to reschedule");
  await withTx(undefined, async (tx) => {
    const reasons = [...(appt.reschedule_reasons ?? []), { reason: input.reason, at: new Date().toISOString() }];
    await tx.query(
      `UPDATE handover_appointment SET confirmed_slot = $1, rescheduled_count = rescheduled_count + 1, reschedule_reasons = $2::jsonb WHERE case_id = $3`,
      [input.slot, JSON.stringify(reasons), view.case.id]
    );
    await appendEvent(tx, {
      type: "handover.appointment_rescheduled",
      entity_type: "handover_record",
      entity_id: view.case.id,
      project_id: view.case.project_id,
      booking_id: bookingId,
      unit_id: view.case.unit_id,
      payload: { slot: input.slot, reason: input.reason },
      ...actorFields(ctx),
    });
    await createAction(
      {
        type: "handover_appointment_reschedule", title: "Confirm new handover appointment slot", project_id: view.case.project_id,
        source_module: "handover", source_entity_type: "handover_record", source_entity_id: view.case.id,
        booking_id: bookingId, unit_id: view.case.unit_id, customer_visible: true,
        customer_title: "Your handover appointment has been rescheduled — please confirm the new slot",
        origin: "AUTO",
      },
      tx
    );
  });
  return buildHandoverView(bookingId);
}

export async function updateChecklist(bookingId: string, patch: Partial<ChecklistRow>, ctx: Ctx): Promise<HandoverView> {
  requireRole(ctx, HANDOVER_ROLES);
  const view = await evaluateCase(bookingId);
  const existing = await loadChecklist(view.case.id);
  const groups: Record<string, Record<string, unknown>> = { ...existing.groups };
  for (const [group, items] of Object.entries(patch.groups ?? {})) {
    groups[group] = { ...(existing.groups[group] ?? {}), ...items };
  }
  const merged: ChecklistRow = {
    groups,
    customer_signature_file_id: patch.customer_signature_file_id ?? existing.customer_signature_file_id,
    company_signature_file_id: patch.company_signature_file_id ?? existing.company_signature_file_id,
    photos: patch.photos ?? existing.photos,
  };
  await db.query(
    `INSERT INTO handover_checklist (case_id, groups, customer_signature_file_id, company_signature_file_id, photos)
     VALUES ($1,$2::jsonb,$3,$4,$5::jsonb)
     ON CONFLICT (case_id) DO UPDATE SET groups = $2::jsonb, customer_signature_file_id = $3, company_signature_file_id = $4, photos = $5::jsonb`,
    [view.case.id, JSON.stringify(merged.groups), merged.customer_signature_file_id, merged.company_signature_file_id, JSON.stringify(merged.photos)]
  );
  return getHandoverCase(bookingId, ctx);
}

/** Rule 2: override requires overridable=true, actor in override_roles, non-empty reason,
 *  evidence if configured, approval if configured (a second user). PHYSICAL's config ships
 *  `overridable: false` (p17 "no override") — this rejects it regardless of role. */
export async function overrideGate(
  bookingId: string,
  input: { gate: string; reason: string; evidence_file_ids?: string[]; approved_by_user_id?: string; valid_until?: string },
  ctx: Ctx
): Promise<HandoverView> {
  // Role/config checks happen against a lazily-created case row (loadOrCreateCase) BEFORE the
  // full evaluateCase (which writes handover_gate_run rows) — an unauthorized attempt shouldn't
  // touch the run log.
  const hoCase = await loadOrCreateCase(bookingId);
  const config = await loadGateConfig(hoCase.project_id);
  const gateConfig = config[input.gate];
  if (!gateConfig || !GATE_DB_TO_TYPE[input.gate]) throw new AppError("validation", "unknown gate", "gate");
  if (!gateConfig.overridable) throw new AppError("forbidden", `${input.gate} cannot be overridden`);
  if (!gateConfig.override_roles.some((r) => ctx.actor.roles.includes(r)) && !ctx.actor.roles.includes("SUPER_ADMIN")) {
    throw new AppError("forbidden", `override requires one of: ${gateConfig.override_roles.join(", ")}`);
  }
  const view = await evaluateCase(bookingId);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  if (gateConfig.requires_evidence && !(input.evidence_file_ids?.length)) throw new AppError("validation", "evidence_file_ids is required for this gate", "evidence_file_ids");
  if (gateConfig.requires_approval && !input.approved_by_user_id) throw new AppError("validation", "approved_by_user_id is required for this gate", "approved_by_user_id");

  await withTx(undefined, async (tx) => {
    const id = randomUUID();
    await tx.query(
      `INSERT INTO handover_override (id, case_id, gate, authority_user_id, authority_role, approved_by_user_id, reason, evidence_file_ids, valid_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, view.case.id, input.gate, ctx.actor.user_id, ctx.actor.roles[0] ?? "UNKNOWN", input.approved_by_user_id ?? null, input.reason, input.evidence_file_ids ?? [], input.valid_until ?? null]
    );
    await appendEvent(tx, {
      type: "handover.gate_overridden",
      entity_type: "handover_record",
      entity_id: view.case.id,
      project_id: view.case.project_id,
      booking_id: bookingId,
      unit_id: view.case.unit_id,
      payload: { gate: input.gate, reason: input.reason },
      ...actorFields(ctx),
    });
  });
  return getHandoverCase(bookingId, ctx);
}

/** Rule 5: all HARD gates PASSED/OVERRIDDEN, checklist required items done, both signatures,
 *  keys `all_handed_over`. Coexists with qa.ts's pre-existing `completeHandover` (legacy AOS-era
 *  flow) exactly like 23's registration/core.ts::completeCase coexists with
 *  legal-docs.ts::completeRegistration — both write the same `handover_record` row and the same
 *  `handover.completed` event; the `already completed` guard stops either path double-firing. */
export async function completeCase(bookingId: string, ctx: Ctx): Promise<HandoverView> {
  requireRole(ctx, HANDOVER_ROLES);
  const view = await evaluateCase(bookingId);
  if (view.case.status === "COMPLETED" || view.case.status === "CLOSED") throw new AppError("conflict", "already completed");
  if (!view.eligible) throw new AppError("conflict", "gate_blocked: hard gates are not all PASSED or OVERRIDDEN");
  const checklist = await loadChecklist(view.case.id);
  // Each checklist item is `{done, by, at, file_ids[]}` (16's Data row) — checklistSkeleton()
  // always populates all_handed_over as that shape, never a bare boolean, so a fresh case (no
  // items ticked) reads done:false here rather than an always-truthy object.
  const keysGroup = checklist.groups.keys as { all_handed_over?: { done?: boolean } } | undefined;
  if (!keysGroup?.all_handed_over?.done) throw new AppError("conflict", "gate_blocked: keys are not all_handed_over on the checklist");
  if (!checklist.customer_signature_file_id || !checklist.company_signature_file_id) throw new AppError("conflict", "gate_blocked: both signatures are required");

  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE handover_record SET status = 'completed', completed_at = now(), keys_issued_at = now() WHERE id = $1`, [view.case.id]);
    await tx.query(`UPDATE unit SET sale_status = 'handed_over' WHERE id = $1`, [view.case.unit_id]);
    await tx.query(`UPDATE booking SET status = 'handed_over' WHERE id = $1`, [bookingId]);
    await appendEvent(tx, {
      type: "handover.completed",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: view.case.project_id,
      booking_id: bookingId,
      unit_id: view.case.unit_id,
      payload: { readiness_value: view.input.readiness_value },
      ...actorFields(ctx),
    });
  });
  // Rule 5: "opens 30 post-handover case (DLP windows start)" — warranty.ts's onHandoverCompleted
  // already does exactly this (dlp_window insert), predating this spec; reused unchanged.
  await onHandoverCompleted(bookingId);
  return getHandoverCase(bookingId, ctx);
}

/** Rule 6: "CLOSED after 30 post-handover onboarding items are done" — those 5 items (FM intro,
 *  maintenance setup, owner record transferred, warranties shared, snag monitoring) have no
 *  tracking table (30 is unbuilt, and 16's own "Not in this feature" excludes FM onboarding
 *  content) — flagged, not faked: this only checks the case is COMPLETED and a dlp_window
 *  exists, then lets FM/Management close it on their own judgment, same class of gap as 23's
 *  unwired rule 6 final demand. */
export async function closeCase(bookingId: string, ctx: Ctx): Promise<HandoverView> {
  requireRole(ctx, HANDOVER_ROLES);
  const row = await loadCaseByBooking(bookingId);
  if (row.status !== "COMPLETED") throw new AppError("conflict", `gate_blocked: case is ${row.status}, not COMPLETED`);
  const dlp = await db.query(`SELECT id FROM dlp_window WHERE booking_id = $1`, [bookingId]);
  if (dlp.rows.length === 0) throw new AppError("conflict", "gate_blocked: no post-handover (DLP) window exists yet");
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE handover_record SET status = 'closed' WHERE id = $1`, [row.id]);
    await appendEvent(tx, {
      type: "handover.closed",
      entity_type: "handover_record",
      entity_id: row.id,
      project_id: row.project_id,
      booking_id: bookingId,
      unit_id: row.unit_id,
      payload: {},
      ...actorFields(ctx),
    });
  });
  return getHandoverCase(bookingId, ctx);
}
