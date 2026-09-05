import { db } from "../db";
import { AppError, type Ctx } from "../authz/types";
import type { DbLike } from "../events";

// 23-registration.md — shared row shapes + loaders, same split-out-store pattern 18/22 used so
// core.ts/readiness.ts/policy.ts can all import without a cycle.

// DB keeps its own lowercase vocabulary (registration_case.status already shipped
// 'readiness_in_progress'/'completed' from the legacy legal-docs.ts flow before this spec —
// same "DB keeps lowercase, translate at the boundary" decision as model/status.ts).
export const REG_STATUSES = [
  "NOT_READY", "READINESS_IN_PROGRESS", "READY", "AVAILABILITY_CONFIRMED",
  "SLOT_BOOKED", "EXECUTED", "COMPLETED", "CANCELLED",
] as const;
export type RegStatus = (typeof REG_STATUSES)[number];

const DB_TO_SPEC: Record<string, RegStatus> = {
  not_ready: "NOT_READY",
  readiness_in_progress: "READINESS_IN_PROGRESS",
  ready: "READY",
  availability_confirmed: "AVAILABILITY_CONFIRMED",
  slot_booked: "SLOT_BOOKED",
  executed: "EXECUTED",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};
const SPEC_TO_DB = Object.fromEntries(Object.entries(DB_TO_SPEC).map(([db_, spec]) => [spec, db_])) as Record<RegStatus, string>;

export function toSpecRegStatus(dbValue: string): RegStatus {
  return DB_TO_SPEC[dbValue] ?? (dbValue.toUpperCase() as RegStatus);
}
export function toDbRegStatus(spec: RegStatus): string {
  return SPEC_TO_DB[spec] ?? spec.toLowerCase();
}

export interface ReadinessFact { ok: boolean; fact: string }
export interface Readiness {
  documents: ReadinessFact;
  clearance: ReadinessFact;
  tds: ReadinessFact;
  agreement_executed: ReadinessFact;
  sale_deed_ready: ReadinessFact;
  customer_availability: ReadinessFact;
  signatories: ReadinessFact;
  poa_valid: ReadinessFact;
}

export interface RegCaseRow {
  id: string; code: string; booking_id: string; unit_id: string; project_id: string;
  status: RegStatus; forecast_date: string | null; forecast_confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  readiness: Readiness; proposed_availability_dates: string[] | null; sro_office: string | null;
  slot_datetime: string | null; slot_reference: string | null;
  slot_history: { from: string | null; to: string; reason: string; by: string | null; at: string }[];
  day_of_checklist: Record<string, boolean>; executed_on: string | null; registration_document_number: string | null;
  company_representative: string | null; customer_attendees: Record<string, unknown>[] | null;
  registered_deed_file_id: string | null; stamp_duty_inr: number | null; registration_fee_inr: number | null;
  outcome_notes: string | null; owner_user_id: string | null; sro_reference: string | null; completed_at: string | null;
}

export const REG_SELECT = `SELECT id, code, booking_id, unit_id, project_id, status, forecast_date::text AS forecast_date,
  forecast_confidence, readiness, proposed_availability_dates, sro_office, slot_datetime::text AS slot_datetime,
  slot_reference, slot_history, day_of_checklist, executed_on::text AS executed_on, registration_document_number,
  company_representative, customer_attendees, registered_deed_file_id, stamp_duty_inr::float8 AS stamp_duty_inr,
  registration_fee_inr::float8 AS registration_fee_inr, outcome_notes, owner_user_id, sro_reference,
  completed_at::text AS completed_at FROM registration_case`;

function mapRow(raw: Omit<RegCaseRow, "status"> & { status: string }): RegCaseRow {
  return { ...raw, status: toSpecRegStatus(raw.status) };
}

export async function loadCase(id: string, tx: DbLike = db): Promise<RegCaseRow> {
  const r = await tx.query<Omit<RegCaseRow, "status"> & { status: string }>(`${REG_SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "registration case not found");
  return mapRow(r.rows[0]);
}

/** Lazily creates the case row for a booking on first touch — same load-or-create shape
 *  financial-clearance.ts's loadOrCreateRow uses. `registration_case.booking_id` stays UNIQUE
 *  (from 0000_init.sql), so this never double-creates. */
export async function loadOrCreateCase(bookingId: string, tx: DbLike = db): Promise<RegCaseRow> {
  const existing = await tx.query<Omit<RegCaseRow, "status"> & { status: string }>(`${REG_SELECT} WHERE booking_id = $1`, [bookingId]);
  if (existing.rows[0]) return mapRow(existing.rows[0]);

  const b = await tx.query<{ project_id: string; unit_id: string }>(`SELECT project_id, unit_id FROM booking WHERE id = $1`, [bookingId]);
  if (!b.rows[0]) throw new AppError("not_found", "booking not found");
  const seq = await tx.query<{ next_value: string }>(
    `INSERT INTO code_sequence (prefix, next_value) VALUES ('REG', 2)
     ON CONFLICT (prefix) DO UPDATE SET next_value = code_sequence.next_value + 1
     RETURNING (next_value - 1)::text AS next_value`
  );
  const code = `REG-${seq.rows[0]!.next_value.padStart(6, "0")}`;
  const id = "reg_" + bookingId;
  await tx.query(
    `INSERT INTO registration_case (id, code, booking_id, unit_id, project_id, status)
     VALUES ($1,$2,$3,$4,$5,'not_ready') ON CONFLICT (booking_id) DO NOTHING`,
    [id, code, bookingId, b.rows[0].unit_id, b.rows[0].project_id]
  );
  return loadCase(id, tx);
}

export async function loadCaseByBooking(bookingId: string, tx: DbLike = db): Promise<RegCaseRow> {
  const r = await tx.query<Omit<RegCaseRow, "status"> & { status: string }>(`${REG_SELECT} WHERE booking_id = $1`, [bookingId]);
  if (!r.rows[0]) throw new AppError("not_found", "registration case not found for this booking");
  return mapRow(r.rows[0]);
}

export interface ChecklistTemplateRow {
  id: string; project_id: string | null; jurisdiction: string | null;
  pre_items: { key: string; label: string }[]; day_of_items: { key: string; label: string }[];
  sro_offices: string[]; jurisdiction_lead_days: number;
}
export const TEMPLATE_SELECT = `SELECT id, project_id, jurisdiction, pre_items, day_of_items, sro_offices, jurisdiction_lead_days FROM registration_checklist_template`;

/** Project-specific row overrides a jurisdiction-matched global row — same precedent 08's gate
 *  rules and 24's sales policies already set for scope resolution. */
export async function loadTemplate(projectId: string, tx: DbLike = db): Promise<ChecklistTemplateRow | null> {
  const project = await tx.query<{ jurisdiction: string | null }>(`SELECT jurisdiction FROM project WHERE id = $1`, [projectId]);
  const jurisdiction = project.rows[0]?.jurisdiction ?? null;
  const byProject = await tx.query<ChecklistTemplateRow>(`${TEMPLATE_SELECT} WHERE project_id = $1`, [projectId]);
  if (byProject.rows[0]) return byProject.rows[0];
  if (jurisdiction) {
    const byJurisdiction = await tx.query<ChecklistTemplateRow>(`${TEMPLATE_SELECT} WHERE project_id IS NULL AND jurisdiction = $1`, [jurisdiction]);
    if (byJurisdiction.rows[0]) return byJurisdiction.rows[0];
  }
  const global = await tx.query<ChecklistTemplateRow>(`${TEMPLATE_SELECT} WHERE project_id IS NULL AND jurisdiction IS NULL`);
  return global.rows[0] ?? null;
}
