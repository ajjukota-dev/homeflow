import { db } from "../db";
import { AppError, type Ctx } from "../authz/types";
import type { DbLike } from "../events";
import { nextCode } from "../model/codes";
import type { GateType, GateClass } from "../handover";

// 16-handover-gates.md — same split-out-store pattern 23's registration/store.ts used.
// ALTER-in-place on the pre-existing `handover_record` (0039): the legacy row (qa.ts's
// completeHandover, only ever writes status='completed') and this spec's stateful case
// coexist on one table, same two-producer pattern as registration_case.

export const HO_STATUSES = ["NOT_STARTED", "PREPARING", "READY", "SCHEDULED", "COMPLETED", "CLOSED"] as const;
export type HoStatus = (typeof HO_STATUSES)[number];

const DB_TO_SPEC: Record<string, HoStatus> = {
  not_started: "NOT_STARTED",
  preparing: "PREPARING",
  ready: "READY",
  scheduled: "SCHEDULED",
  completed: "COMPLETED",
  closed: "CLOSED",
};
const SPEC_TO_DB = Object.fromEntries(Object.entries(DB_TO_SPEC).map(([db_, spec]) => [spec, db_])) as Record<HoStatus, string>;

export function toSpecHoStatus(dbValue: string): HoStatus {
  return DB_TO_SPEC[dbValue] ?? (dbValue.toUpperCase() as HoStatus);
}
export function toDbHoStatus(spec: HoStatus): string {
  return SPEC_TO_DB[spec] ?? spec.toLowerCase();
}

// handover_gate_config.gate / handover_gate_run.gate spell gate names in SCREAMING_SNAKE
// (0039's CHECK constraint); handover.ts's GateType is the lowercase pure-engine vocabulary —
// same DB/API split as registration_case.status.
export const GATE_DB_TO_TYPE: Record<string, Exclude<GateType, "snags">> = {
  FINANCIAL: "financial", LEGAL: "legal", REGISTRATION: "registration", PHYSICAL: "physical",
  QUALITY: "quality", COMMITMENTS: "commitments", CUSTOMER: "customer", FM_COMMUNITY: "fm",
};
export const GATE_TYPE_TO_DB = Object.fromEntries(Object.entries(GATE_DB_TO_TYPE).map(([k, v]) => [v, k])) as Record<Exclude<GateType, "snags">, string>;

export interface HoCaseRow {
  id: string; code: string; booking_id: string; unit_id: string; project_id: string;
  status: HoStatus; predicted_date: string | null; predicted_confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  readiness_score_snapshot_id: string | null; keys_issued_at: string | null; completed_at: string | null;
}

export const HO_SELECT = `SELECT id, code, booking_id, unit_id, project_id, status, predicted_date::text AS predicted_date,
  predicted_confidence, readiness_score_snapshot_id, keys_issued_at::text AS keys_issued_at,
  completed_at::text AS completed_at FROM handover_record`;

function mapRow(raw: Omit<HoCaseRow, "status"> & { status: string }): HoCaseRow {
  // The legacy writer (qa.ts::completeHandover) only ever sets 'completed' — any other legacy
  // value falls through toSpecHoStatus's uppercase fallback, same convention as 23's store.
  return { ...raw, status: toSpecHoStatus(raw.status) };
}

export async function loadCase(id: string, tx: DbLike = db): Promise<HoCaseRow> {
  const r = await tx.query<Omit<HoCaseRow, "status"> & { status: string }>(`${HO_SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "handover case not found");
  return mapRow(r.rows[0]);
}

/** Lazily creates the case row for a booking on first touch — booking_id stays UNIQUE
 *  (0000_init.sql), so this never double-creates. */
export async function loadOrCreateCase(bookingId: string, tx: DbLike = db): Promise<HoCaseRow> {
  const existing = await tx.query<Omit<HoCaseRow, "status"> & { status: string }>(`${HO_SELECT} WHERE booking_id = $1`, [bookingId]);
  if (existing.rows[0]) return mapRow(existing.rows[0]);

  const b = await tx.query<{ project_id: string; unit_id: string }>(`SELECT project_id, unit_id FROM booking WHERE id = $1`, [bookingId]);
  if (!b.rows[0]) throw new AppError("not_found", "booking not found");
  const code = await nextCode(tx, "HO");
  const id = "ho_" + bookingId;
  await tx.query(
    `INSERT INTO handover_record (id, code, booking_id, unit_id, project_id, status)
     VALUES ($1,$2,$3,$4,$5,'not_started') ON CONFLICT (booking_id) DO NOTHING`,
    [id, code, bookingId, b.rows[0].unit_id, b.rows[0].project_id]
  );
  return loadCase(id, tx);
}

export async function loadCaseByBooking(bookingId: string, tx: DbLike = db): Promise<HoCaseRow> {
  const r = await tx.query<Omit<HoCaseRow, "status"> & { status: string }>(`${HO_SELECT} WHERE booking_id = $1`, [bookingId]);
  if (!r.rows[0]) throw new AppError("not_found", "handover case not found for this booking");
  return mapRow(r.rows[0]);
}

// DB/API spell classification HARD/SOFT (0039's CHECK constraint, spec's own vocabulary);
// handover.ts's pure engine takes lowercase GateClass — translate at the boundary.
export interface GateConfigRow {
  gate: string; classification: "HARD" | "SOFT"; overridable: boolean; override_roles: string[];
  requires_approval: boolean; requires_evidence: boolean; params: Record<string, unknown>;
}
export function toGateClass(c: "HARD" | "SOFT"): GateClass {
  return c === "HARD" ? "hard" : "soft";
}

// p17 §9, verbatim (see handover.ts's DEFAULT_GATE_CLASS for the full citation). Physical has
// no override at all; Financial overrides only by Management (its own override_roles). Seeded
// into handover_gate_config by seed/handover-gates.ts — this fallback covers a fresh DB before
// that seed runs, or a project with no config row at all.
const FALLBACK_CONFIG: Record<string, GateConfigRow> = {
  FINANCIAL: { gate: "FINANCIAL", classification: "HARD", overridable: true, override_roles: ["MANAGEMENT", "SUPER_ADMIN"], requires_approval: true, requires_evidence: false, params: {} },
  LEGAL: { gate: "LEGAL", classification: "HARD", overridable: true, override_roles: ["LEGAL", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
  REGISTRATION: { gate: "REGISTRATION", classification: "HARD", overridable: true, override_roles: ["REGISTRATION", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: { allow_possession_before_registration: false } },
  PHYSICAL: { gate: "PHYSICAL", classification: "HARD", overridable: false, override_roles: [], requires_approval: false, requires_evidence: false, params: {} },
  QUALITY: { gate: "QUALITY", classification: "HARD", overridable: true, override_roles: ["QA", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: true, params: { critical_open_max: 0, major_open_max: 0 } },
  COMMITMENTS: { gate: "COMMITMENTS", classification: "HARD", overridable: true, override_roles: ["CRM", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
  CUSTOMER: { gate: "CUSTOMER", classification: "SOFT", overridable: true, override_roles: ["CRM", "QA", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
  FM_COMMUNITY: { gate: "FM_COMMUNITY", classification: "SOFT", overridable: true, override_roles: ["FM", "MANAGEMENT", "SUPER_ADMIN"], requires_approval: false, requires_evidence: false, params: {} },
};

/** Project-specific row overrides the standard (project_id null) row — same scope-resolution
 *  precedent as 23's loadTemplate. Returns one row per gate, always all 8. */
export async function loadGateConfig(projectId: string, tx: DbLike = db): Promise<Record<string, GateConfigRow>> {
  const rows = await tx.query<GateConfigRow>(
    `SELECT DISTINCT ON (gate) gate, classification, overridable, override_roles, requires_approval, requires_evidence, params
       FROM handover_gate_config
      WHERE (project_id = $1 OR project_id IS NULL) AND (effective_to IS NULL OR effective_to > now())
      ORDER BY gate, project_id NULLS LAST, version DESC`,
    [projectId]
  );
  const byGate: Record<string, GateConfigRow> = { ...FALLBACK_CONFIG };
  for (const r of rows.rows) byGate[r.gate] = r;
  return byGate;
}
