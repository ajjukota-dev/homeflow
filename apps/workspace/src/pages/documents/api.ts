// 22-document-factory.md §API. Same req/unwrap pattern as pages/customisation/api.ts and
// pages/finance/api.ts. `listDocuments`/`loadDocument` attach unit_number/booking_number/
// customer_name server-side (documents/store.ts) — never render booking_id/unit_id/customer_id
// raw in this factory.
import { ApiError } from "../../auth/api";

export type DocumentStatus =
  | "DRAFT" | "INTERNAL_REVIEW" | "AWAITING_APPROVAL" | "CUSTOMER_REVIEW" | "APPROVED_FOR_EXECUTION"
  | "FINAL" | "ARCHIVED" | "REJECTED" | "SUPERSEDED";

export interface SelectedClause { code: string; title: string; type: "LOCKED" | "PARAMETERIZED" | "NEGOTIABLE_WITH_APPROVAL"; body_html: string; parameters: Record<string, unknown> }
export interface RedlineSummary { fields_changed: string[]; clauses_added: string[]; clauses_removed: string[] }

export interface DocumentRow {
  id: string; code: string; family_code: string; template_id: string; booking_id: string | null; unit_id: string | null; customer_id: string | null; project_id: string;
  unit_number: string | null; booking_number: string | null; customer_name: string | null;
  data_snapshot: Record<string, unknown>; selected_clauses: SelectedClause[]; version: number; status: DocumentStatus;
  pdf_file_key: string | null; checksum: string | null; is_draft_watermarked: boolean; redline_summary: RedlineSummary | null; superseded_by_id: string | null; generated_at: string;
}

export interface ReadinessFact { level: "INFO" | "WARNING" | "BLOCKED"; message: string }
export interface ReadinessResult {
  result: "READY" | "WARNING" | "BLOCKED"; facts: ReadinessFact[];
  template: { id: string; name: string; version: number; body_html: string } | null;
  clauses: { code: string; title: string; type: string; parameters: Record<string, unknown> }[];
  missing_clause_codes: string[];
}

export interface DeviationRow { id: string; document_id: string; clause_code: string; original: string | null; proposed: string; reason: string; raised_by: string; status: "RAISED" | "APPROVED" | "REJECTED"; approved_by: string | null; created_at: string }
export type ApprovalStage = "INTERNAL_REVIEW" | "LEGAL" | "COMMERCIAL";
export interface DocumentApproval { document_id: string; stage: ApprovalStage; approver_user_id: string; decision: "APPROVED" | "REJECTED"; note: string | null; at: string }

export type TemplateStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "RETIRED";
export interface TemplateRow {
  id: string; family_code: string; name: string; project_id: string | null; legal_entity: string | null; product_types: string[];
  transaction_type: string; jurisdiction: string | null; effective_from: string | null; effective_to: string | null;
  version: number; status: TemplateStatus; body_html: string; checksum: string | null; approved_by: string | null; approved_at: string | null; created_at: string;
}
export interface ClauseRow {
  id: string; code: string; title: string; body_html: string; category: string | null; type: "LOCKED" | "PARAMETERIZED" | "NEGOTIABLE_WITH_APPROVAL";
  parameters: Record<string, unknown>; version: number; status: "DRAFT" | "APPROVED" | "RETIRED"; approved_by: string | null; approved_at: string | null;
}
export interface SelectionRule { id: string; template_id: string; clause_code: string; condition: string | null; position: number }
export interface MergeFieldRow { code: string; source_path: string; type: "STRING" | "NUMBER" | "DATE" | "MONEY" | "BOOLEAN"; format: string | null; required: boolean; sensitivity: string | null }
export interface ChecklistRuleRow { id: string; residency: string; product_type: string | null; project_id: string | null; category: string; required: boolean; stage_code: string | null }

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function req<T>(path: string, method: string, body?: unknown): Promise<T> {
  return fetch(path, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined }).then((r) => unwrap<T>(r));
}

export interface BookingPickerRow { id: string; unit_number: string; booking_number: string; applicant_name: string | null }

export const documentsApi = {
  // LEGAL has no access to the "sales_handover" module that api.ts::listBookings gates on
  // (seed/permissions.ts MATRIX) — this picker gates on "documents" READ instead, which LEGAL has.
  bookings: (projectId?: string) => req<BookingPickerRow[]>(`/api/documents/bookings${projectId ? `?project_id=${projectId}` : ""}`, "GET"),
  list: (filter: { project_id?: string; booking_id?: string; status?: string; family_code?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
    return req<DocumentRow[]>(`/api/documents?${qs}`, "GET");
  },
  get: (id: string) => req<DocumentRow>(`/api/documents/${id}`, "GET"),
  readiness: (bookingId: string, family: string) => req<ReadinessResult>(`/api/bookings/${bookingId}/documents/readiness?family=${family}`, "GET"),
  generate: (bookingId: string, family: string, clauseParams?: Record<string, unknown>) => req<DocumentRow>(`/api/bookings/${bookingId}/documents/generate`, "POST", { family, clause_params: clauseParams ?? {} }),
  submitForReview: (id: string) => req<DocumentRow>(`/api/documents/${id}/submit-review`, "POST"),
  approve: (id: string, stage: string, note?: string) => req<DocumentRow>(`/api/documents/${id}/approve`, "POST", { stage, note }),
  reject: (id: string, stage: string, note?: string) => req<DocumentRow>(`/api/documents/${id}/reject`, "POST", { stage, note }),
  sendCustomerReview: (id: string) => req<DocumentRow>(`/api/documents/${id}/send-customer-review`, "POST"),
  approveForExecution: (id: string) => req<DocumentRow>(`/api/documents/${id}/approve-for-execution`, "POST"),
  recordExecution: (id: string, input: { mode: "ESIGN" | "WET_SIGNATURE" | "REGISTRATION"; executed_on: string; sro_reference?: string }) => req<DocumentRow>(`/api/documents/${id}/record-execution`, "POST", input),
  archive: (id: string) => req<DocumentRow>(`/api/documents/${id}/archive`, "POST"),
  approvals: (id: string) => req<DocumentApproval[]>(`/api/documents/${id}/approvals`, "GET"),
  deviations: (id: string) => req<DeviationRow[]>(`/api/documents/${id}/deviations`, "GET"),
  raiseDeviation: (id: string, input: { clause_code: string; proposed: string; reason: string }) => req<DeviationRow>(`/api/documents/${id}/deviations`, "POST", input),
  approveDeviation: (id: string) => req<DeviationRow>(`/api/deviations/${id}/approve`, "POST"),
  rejectDeviation: (id: string) => req<DeviationRow>(`/api/deviations/${id}/reject`, "POST"),

  // Studio: templates
  templates: (filter: { family_code?: string; project_id?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
    return req<TemplateRow[]>(`/api/document-templates?${qs}`, "GET");
  },
  createTemplate: (input: Partial<TemplateRow> & { family_code: string; name: string; transaction_type: string; body_html: string }) => req<TemplateRow>(`/api/document-templates`, "POST", input),
  updateTemplate: (id: string, version: number, input: Partial<TemplateRow>) => req<TemplateRow>(`/api/document-templates/${id}/versions/${version}`, "PUT", input),
  submitTemplateForReview: (id: string) => req<TemplateRow>(`/api/document-templates/${id}/submit-review`, "POST"),
  approveTemplate: (id: string, changeNote?: string) => req<TemplateRow>(`/api/document-templates/${id}/approve`, "POST", { change_note: changeNote }),
  retireTemplate: (id: string) => req<TemplateRow>(`/api/document-templates/${id}/retire`, "POST"),

  // Studio: clauses
  clauses: () => req<ClauseRow[]>(`/api/clauses`, "GET"),
  createClause: (input: Partial<ClauseRow> & { code: string; title: string; body_html: string; type: string }) => req<ClauseRow>(`/api/clauses`, "POST", input),
  updateClause: (id: string, version: number, input: Partial<ClauseRow>) => req<ClauseRow>(`/api/clauses/${id}/versions/${version}`, "PUT", input),
  approveClause: (id: string) => req<ClauseRow>(`/api/clauses/${id}/approve`, "POST"),

  // Studio: selection rules
  selectionRules: (templateId: string) => req<SelectionRule[]>(`/api/document-templates/${templateId}/clause-rules`, "GET"),
  putSelectionRules: (templateId: string, rules: { clause_code: string; condition?: string | null }[]) => req<SelectionRule[]>(`/api/document-templates/${templateId}/clause-rules`, "PUT", { rules }),

  // Studio: merge fields
  mergeFields: () => req<MergeFieldRow[]>(`/api/merge-fields`, "GET"),
  putMergeFields: (fields: MergeFieldRow[]) => req<MergeFieldRow[]>(`/api/merge-fields`, "PUT", { fields }),

  // Studio: checklist rules
  checklistRules: () => req<ChecklistRuleRow[]>(`/api/document-checklist-rules`, "GET"),
  putChecklistRules: (rules: Omit<ChecklistRuleRow, "id">[]) => req<ChecklistRuleRow[]>(`/api/document-checklist-rules`, "PUT", { rules }),
};
