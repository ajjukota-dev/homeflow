import { createHash } from "node:crypto";
import { db } from "./db";
import type { GeneratedDocumentRow, SourceRow } from "./legal-docs-types";

// Shared booking-source lookup, live snapshot, and generated-document fetch/checksum
// used by legal-docs.ts generation, approval, execution, and registration (legal/spec.md H4/H7).

export function checksum(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export async function source(bookingId: string): Promise<SourceRow> {
  const r = await db.query<SourceRow>(
    `SELECT b.id, b.project_id, b.unit_id, b.booking_number,
            b.total_consideration::float8 AS total_consideration,
            u.unit_number, u.unit_type, u.facing, p.name AS project_name,
            a.display_name, a.pan
       FROM booking b
       JOIN unit u ON u.id = b.unit_id
       JOIN project p ON p.id = b.project_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.id = $1`,
    [bookingId]
  );
  if (r.rows.length === 0) throw new Error("booking_not_found");
  return r.rows[0];
}

export function liveSnapshot(row: SourceRow): Record<string, string | null> {
  return {
    applicant_name: row.display_name,
    pan: row.pan,
    unit_number: row.unit_number,
    unit_type: row.unit_type,
    facing: row.facing,
    project_name: row.project_name,
    booking_number: row.booking_number,
    consideration: String(row.total_consideration),
  };
}

export async function getDocument(id: string) {
  const r = await db.query<GeneratedDocumentRow>(
    `SELECT id, booking_id, document_family, status, version, snapshot, body_rendered, checksum, created_at
       FROM generated_document WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}
