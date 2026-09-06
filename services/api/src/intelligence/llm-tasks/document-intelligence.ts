import { db } from "../../db";
import { llm } from "../../llm";
import { AppError, type Ctx } from "../../authz/types";
import { withinBudget, createSuggestion, reviewSuggestion, loadSuggestion, type LlmTaskRow } from "./store";

// 31-intelligence.md rule 5, 3rd bullet: "extract fields from uploaded KYC/challans (PAN, name,
// dates) to prefill validation; flag inconsistencies between generated document data_snapshot and
// source records; never auto-accepts a document."
//
// Real gap, flagged not faked: the `llm` port (03) is text-only (`LlmCompleteInput` has no
// image/file field) and `customer_document.file_keys` are opaque object-store keys, not OCR'd
// text anywhere in this codebase — so DOCUMENT_FIELD_EXTRACTION here can only pass the document's
// own category/status metadata to the LLM, not its actual scanned content. The task/suggestion
// plumbing (creation, budget check, review) is real and complete; the extraction quality is
// necessarily low until a vision-capable adapter or an OCR step is added ahead of this call — that
// is future work, not something to silently fake here.
//
// DOCUMENT_INCONSISTENCY has no such gap: `doc_factory_document.data_snapshot` is real structured
// JSON, compared here against the real source booking/customer/unit rows it was generated from —
// a genuine text/JSON comparison task, exactly what this port is for.

export async function createFieldExtractionSuggestion(customerDocumentId: string): Promise<LlmTaskRow> {
  if (!(await withinBudget())) throw new AppError("conflict", "LLM monthly budget exhausted for this month — rule-based features are unaffected");
  const doc = await db.query<{ category: string; status: string; file_keys: string[] }>(
    `SELECT category, status, file_keys FROM customer_document WHERE id = $1`,
    [customerDocumentId]
  );
  if (!doc.rows[0]) throw new AppError("not_found", "customer document not found");

  const result = await llm.complete({
    system: "You prefill a KYC validation form. No scanned document content is available to you — only its category and filenames. Return your best-guess field NAMES this category of document usually carries (not values), and set confidence low to reflect that no real content was read.",
    user: `category: ${doc.rows[0].category}; status: ${doc.rows[0].status}; files: ${doc.rows[0].file_keys.join(", ") || "none"}`,
    json_schema: { type: "object", properties: { fields: { type: "array", items: { type: "string" } }, confidence: { type: "number" } }, required: ["fields"] },
    purpose: "document_field_extraction",
  });
  const output = (result.json ?? {}) as Record<string, unknown>;
  const confidence = typeof output.confidence === "number" ? output.confidence : 0.1; // no real content read — low by default
  return createSuggestion("DOCUMENT_FIELD_EXTRACTION", customerDocumentId, output, confidence, result);
}

export async function createInconsistencySuggestion(docFactoryDocumentId: string): Promise<LlmTaskRow> {
  if (!(await withinBudget())) throw new AppError("conflict", "LLM monthly budget exhausted for this month — rule-based features are unaffected");
  const doc = await db.query<{ data_snapshot: Record<string, unknown>; booking_id: string | null; customer_id: string | null }>(
    `SELECT data_snapshot, booking_id, customer_id FROM doc_factory_document WHERE id = $1`,
    [docFactoryDocumentId]
  );
  if (!doc.rows[0]) throw new AppError("not_found", "document not found");

  const source = await db.query<{ display_name: string | null; primary_phone: string | null; total_consideration: number | null }>(
    `SELECT c.display_name, c.primary_phone, b.total_consideration::float8 AS total_consideration
       FROM booking b LEFT JOIN customer c ON c.id = $2 WHERE b.id = $1`,
    [doc.rows[0].booking_id, doc.rows[0].customer_id]
  );

  const result = await llm.complete({
    system: "Compare the SNAPSHOT (frozen at document generation time) against the SOURCE (current live records). List only fields present in both that disagree — never speculate about fields absent from either side.",
    user: JSON.stringify({ snapshot: doc.rows[0].data_snapshot, source: source.rows[0] ?? {} }),
    json_schema: { type: "object", properties: { inconsistencies: { type: "array", items: { type: "object", properties: { field: { type: "string" }, snapshot_value: { type: "string" }, source_value: { type: "string" } } } } }, required: ["inconsistencies"] },
    purpose: "document_inconsistency",
  });
  const output = (result.json ?? {}) as Record<string, unknown>;
  return createSuggestion("DOCUMENT_INCONSISTENCY", docFactoryDocumentId, output, null, result);
}

/** Rule 5's "never auto-accepts a document" — accepting either kind only marks the suggestion
 *  reviewed. Neither writes back into `doc_factory_document`/`customer_document`: a field
 *  extraction is a prefill for a human-driven validation form (not built), and an inconsistency
 *  flag is something staff acts on manually, not a field this codebase overwrites automatically. */
export async function acceptDocumentSuggestion(id: string, ctx: Ctx, expectedKind: "DOCUMENT_FIELD_EXTRACTION" | "DOCUMENT_INCONSISTENCY"): Promise<LlmTaskRow> {
  const task = await loadSuggestion(id);
  if (task.kind !== expectedKind) throw new AppError("validation", `not a ${expectedKind.toLowerCase()} suggestion`);
  return reviewSuggestion(id, "accepted", ctx);
}
