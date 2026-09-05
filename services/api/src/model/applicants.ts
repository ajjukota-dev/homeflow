import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, type DbLike } from "../events";
import { ValidationError } from "./derive";

// booking_applicant (04 §Data, rule 4): exactly one PRIMARY, max 4 (config), ownership_pct
// sums to 100 when set. PUT /bookings/:id/applicants replaces the full list (diff → events).

export type ApplicantRole = "PRIMARY" | "CO_APPLICANT" | "POA" | "NOMINEE";
export const MAX_APPLICANTS = 4; // [E §13] — Policy Studio config once 25-policy-studio lands

export interface ApplicantInput {
  id?: string; // omit for a new applicant
  customer_id?: string | null;
  display_name: string;
  role: ApplicantRole;
  ownership_pct?: number | null;
  phone?: string | null;
  pan?: string | null;
  sort_order?: number;
}

export interface ApplicantRow {
  id: string;
  customer_id: string | null;
  display_name: string;
  role: ApplicantRole;
  ownership_pct: number | null;
  phone: string | null;
  pan: string | null;
  sort_order: number;
}

// The DB keeps 'primary' lowercase (existing default/10 read sites) — see model/status.ts
// for why this codebase translates spec vocabulary at the write/read boundary instead of
// renaming the stored value.
const toDbRole = (role: ApplicantRole): string => (role === "PRIMARY" ? "primary" : role);
const toSpecRole = (role: string): ApplicantRole => (role === "primary" ? "PRIMARY" : (role as ApplicantRole));

export async function listApplicants(bookingId: string, handle: DbLike = db): Promise<ApplicantRow[]> {
  const r = await handle.query<{
    id: string;
    customer_id: string | null;
    display_name: string;
    role: string;
    ownership_pct: number | null;
    phone: string | null;
    pan: string | null;
    sort_order: number;
  }>(
    `SELECT id, customer_id, display_name, role, ownership_pct::float8 AS ownership_pct, phone, pan, sort_order
       FROM booking_applicant WHERE booking_id = $1 ORDER BY sort_order`,
    [bookingId]
  );
  return r.rows.map((row) => ({ ...row, role: toSpecRole(row.role) }));
}

export async function setApplicants(bookingId: string, applicants: ApplicantInput[]): Promise<ApplicantRow[]> {
  if (applicants.length === 0) throw new ValidationError("at least one applicant required");
  if (applicants.length > MAX_APPLICANTS) throw new ValidationError(`max ${MAX_APPLICANTS} applicants`);
  const primaries = applicants.filter((a) => a.role === "PRIMARY");
  if (primaries.length !== 1) throw new ValidationError("exactly one PRIMARY applicant required");
  const withPct = applicants.filter((a) => a.ownership_pct != null);
  if (withPct.length > 0) {
    const sum = withPct.reduce((s, a) => s + (a.ownership_pct ?? 0), 0);
    if (Math.round(sum) !== 100) throw new ValidationError("ownership_pct must sum to 100 when set", "ownership_pct");
  }

  const booking = await db.query<{ project_id: string; unit_id: string }>(
    `SELECT project_id, unit_id FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (booking.rows.length === 0) throw new ValidationError("booking_not_found");
  const { project_id: projectId, unit_id: unitId } = booking.rows[0];

  const existing = await db.query<{ id: string }>(`SELECT id FROM booking_applicant WHERE booking_id = $1`, [
    bookingId,
  ]);
  const keptIds = new Set(applicants.filter((a) => a.id).map((a) => a.id));
  const removedIds = existing.rows.map((r) => r.id).filter((id) => !keptIds.has(id));

  return withTx(undefined, async (t) => {
    for (const id of removedIds) {
      await t.query(`DELETE FROM booking_applicant WHERE id = $1`, [id]);
      await appendEvent(t, {
        type: "applicant.removed",
        entity_type: "booking_applicant",
        entity_id: id,
        project_id: projectId,
        booking_id: bookingId,
        unit_id: unitId,
        payload: {},
      });
    }
    for (const a of applicants) {
      if (a.id) {
        await t.query(
          `UPDATE booking_applicant
              SET display_name=$2, role=$3, ownership_pct=$4, phone=$5, pan=$6, sort_order=$7, customer_id=$8
            WHERE id=$1`,
          [a.id, a.display_name, toDbRole(a.role), a.ownership_pct ?? null, a.phone ?? null, a.pan ?? null, a.sort_order ?? 1, a.customer_id ?? null]
        );
      } else {
        const id = randomUUID();
        await t.query(
          `INSERT INTO booking_applicant (id, booking_id, customer_id, display_name, role, ownership_pct, phone, pan, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, bookingId, a.customer_id ?? null, a.display_name, toDbRole(a.role), a.ownership_pct ?? null, a.phone ?? null, a.pan ?? null, a.sort_order ?? 1]
        );
        await appendEvent(t, {
          type: "applicant.added",
          entity_type: "booking_applicant",
          entity_id: id,
          project_id: projectId,
          booking_id: bookingId,
          unit_id: unitId,
          payload: { display_name: a.display_name, role: a.role },
        });
      }
    }
    return listApplicants(bookingId, t);
  });
}
