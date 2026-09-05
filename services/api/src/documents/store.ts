import { db } from "../db";
import { AppError } from "../authz/types";
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
