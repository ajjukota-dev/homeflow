import { db } from "../db";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import type { DbLike } from "../events";

// Shared row shape + loader for doc_factory_document, split out from generate.ts so
// deviations.ts (which validates against a document's selected_clauses) and generate.ts (which
// applies approved deviations on regeneration) don't import each other.

export interface SelectedClause { code: string; title: string; type: string; body_html: string; parameters: Record<string, unknown> }
export interface RedlineSummary { fields_changed: string[]; clauses_added: string[]; clauses_removed: string[] }

export interface DocumentRow {
  id: string; code: string; family_code: string; template_id: string; booking_id: string | null; unit_id: string | null; customer_id: string | null; project_id: string;
  data_snapshot: Record<string, unknown>; selected_clauses: SelectedClause[]; version: number; status: string;
  pdf_file_key: string | null; checksum: string | null; is_draft_watermarked: boolean; redline_summary: RedlineSummary | null; superseded_by_id: string | null; generated_at: string;
}
export const DOCUMENT_SELECT = `SELECT id, code, family_code, template_id, booking_id, unit_id, customer_id, project_id, data_snapshot, selected_clauses, version, status,
  pdf_file_key, checksum, is_draft_watermarked, redline_summary, superseded_by_id, generated_at::text AS generated_at FROM doc_factory_document`;

export async function loadDocument(id: string, tx: DbLike = db): Promise<DocumentRow> {
  const r = await tx.query<DocumentRow>(`${DOCUMENT_SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "document not found");
  return r.rows[0];
}

// Real gap filled for the UI's queue screen: no list endpoint existed for doc_factory_document at
// all before this build (only loadDocument-by-id). Joins friendly labels the same way
// routes-change-requests.ts's own withLabels() does — a document row must never show a raw
// booking_id/unit_id/customer_id in a list.
export interface DocumentListRow extends DocumentRow { unit_number: string | null; booking_number: string | null; customer_name: string | null }

export async function listDocuments(filter: { project_id?: string; booking_id?: string; status?: string; family_code?: string }, ctx: Ctx): Promise<DocumentListRow[]> {
  await authorize(ctx, "documents", "READ");
  const r = await db.query<DocumentListRow>(
    `SELECT d.id, d.code, d.family_code, d.template_id, d.booking_id, d.unit_id, d.customer_id, d.project_id,
            d.data_snapshot, d.selected_clauses, d.version, d.status, d.pdf_file_key, d.checksum, d.is_draft_watermarked,
            d.redline_summary, d.superseded_by_id, d.generated_at::text AS generated_at,
            u.unit_number, b.booking_number, c.display_name AS customer_name
       FROM doc_factory_document d
       LEFT JOIN unit u ON u.id = d.unit_id
       LEFT JOIN booking b ON b.id = d.booking_id
       LEFT JOIN customer c ON c.id = d.customer_id
      WHERE ($1::text IS NULL OR d.project_id = $1)
        AND ($2::text IS NULL OR d.booking_id = $2)
        AND ($3::text IS NULL OR d.status = $3)
        AND ($4::text IS NULL OR d.family_code = $4)
      ORDER BY d.generated_at DESC`,
    [filter.project_id ?? null, filter.booking_id ?? null, filter.status ?? null, filter.family_code ?? null]
  );
  return r.rows;
}

// Real gap found live (MCP browser test): every route that returns a single DocumentRow (generate,
// GET :id, submit-review, approve, reject, ...) came back with unit_number/booking_number/
// customer_name missing — loadDocument() (used internally by generate.ts/workflow.ts for business
// logic, so its own return shape must stay unjoined) never carried them, unlike listDocuments's
// query. The drawer showed blank Booking/Unit/Customer fields after every action. Routes wrap
// their response through this instead of changing loadDocument's shape.
export async function withLabels(doc: DocumentRow): Promise<DocumentListRow> {
  const r = await db.query<{ unit_number: string | null; booking_number: string | null; customer_name: string | null }>(
    `SELECT u.unit_number, b.booking_number, c.display_name AS customer_name
       FROM (SELECT $1::text AS unit_id, $2::text AS booking_id, $3::text AS customer_id) x
       LEFT JOIN unit u ON u.id = x.unit_id
       LEFT JOIN booking b ON b.id = x.booking_id
       LEFT JOIN customer c ON c.id = x.customer_id`,
    [doc.unit_id, doc.booking_id, doc.customer_id]
  );
  const labels = r.rows[0] ?? { unit_number: null, booking_number: null, customer_name: null };
  return { ...doc, ...labels };
}

// Real gap found live (MCP browser test as legal@demo.pranava): GenerateWizard's booking picker
// reused bookings.ts::listBookings, which gates on the "sales_handover" module — LEGAL has NONE
// there per seed/permissions.ts's MATRIX. LEGAL does have WRITE on "documents", so this picker
// gates on that instead of widening sales_handover's own, deliberately narrower, access.
export interface BookingPickerRow { id: string; unit_number: string; booking_number: string; applicant_name: string | null }

export async function listBookingsForDocuments(projectId: string | undefined, ctx: Ctx): Promise<BookingPickerRow[]> {
  await authorize(ctx, "documents", "READ");
  const r = await db.query<BookingPickerRow>(
    `SELECT b.id, u.unit_number, b.booking_number, a.display_name AS applicant_name
       FROM booking b
       JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.status = 'active' AND ($1::text IS NULL OR b.project_id = $1)
      ORDER BY u.unit_number`,
    [projectId ?? null]
  );
  return r.rows;
}
