import { db } from "../db";
import type { DbLike } from "../events";

// deriveProjectId (04 rule 2, p36 §31.1): "Any downstream insert carrying project_id must
// equal the Unit's/Booking's project; mismatch → validation. Implement once." Never ask a
// user for a value that can be derived (CLAUDE.md). Callers pass exactly one of unit_id or
// booking_id — whichever the new row is keyed on.

export class ValidationError extends Error {
  code = "validation" as const;
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

export async function deriveProjectId(
  ref: { unit_id: string; booking_id?: undefined } | { booking_id: string; unit_id?: undefined },
  handle: DbLike = db
): Promise<string> {
  if (ref.unit_id) {
    const r = await handle.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = $1`, [ref.unit_id]);
    if (r.rows.length === 0) throw new ValidationError("unit_not_found", "unit_id");
    return r.rows[0].project_id;
  }
  const r = await handle.query<{ project_id: string }>(`SELECT project_id FROM booking WHERE id = $1`, [
    ref.booking_id,
  ]);
  if (r.rows.length === 0) throw new ValidationError("booking_not_found", "booking_id");
  return r.rows[0].project_id;
}

/** Validates a caller-supplied project_id against the derived one (04 rule 2). */
export function assertProjectMatch(suppliedProjectId: string | undefined, derivedProjectId: string): void {
  if (suppliedProjectId && suppliedProjectId !== derivedProjectId) {
    throw new ValidationError(
      `project_id ${suppliedProjectId} does not match the unit/booking's project ${derivedProjectId}`,
      "project_id"
    );
  }
}
