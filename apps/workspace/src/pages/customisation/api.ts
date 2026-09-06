// 18-change-requests.md §API. Same req/unwrap pattern as pages/finance/api.ts and
// pages/management/api.ts. `withLabels` on the API side attaches unit_number/booking_number
// (routes-change-requests.ts) — never render `unit_id`/`booking_id` raw in this desk.
import { ApiError } from "../../auth/api";

export type CrStatus =
  | "DRAFT" | "REQUESTED" | "FEASIBILITY_REVIEW" | "COSTING" | "AWAITING_APPROVAL" | "AWAITING_CUSTOMER"
  | "AWAITING_PAYMENT" | "APPROVED" | "RELEASED" | "IN_PROGRESS" | "READY_FOR_QA" | "QA_VERIFIED"
  | "CUSTOMER_ACCEPTED" | "AS_BUILT_CLOSED" | "REJECTED" | "WITHDRAWN" | "CANCELLED";

export interface FeasibilityInfo { result: "FEASIBLE" | "FEASIBLE_WITH_CONDITIONS" | "NOT_FEASIBLE"; technical_notes: string; reviewer: string | null; at: string }
export interface ImpactInfo { cost_inr: number; schedule_days: number; technical_risk: "LOW" | "MEDIUM" | "HIGH"; handover_impact: "NONE" | "DELAYS_HANDOVER" | "BLOCKS_HANDOVER"; notes: string }

export interface ChangeRequest {
  id: string; code: string; booking_id: string; unit_id: string; project_id: string; customer_id: string | null;
  unit_number: string | null; booking_number: string | null;
  raised_by_kind: "CUSTOMER_PORTAL" | "SALES" | "CRM" | "CUSTOMISATION"; raised_by_user_id: string | null;
  status: CrStatus; title: string; summary: string | null; primary_category_code: string | null;
  freeze_state_at_request: "PRE_FREEZE" | "POST_FREEZE"; gate_summary_at_request: Record<string, string>;
  exception_id: string | null; feasibility: FeasibilityInfo | null; impact: ImpactInfo | null;
  quotation_id: string | null; payment_gate: "REQUIRED" | "WAIVED" | null; payment_waiver_authority: string | null;
  payment_demand_id: string | null; released_at: string | null; released_by: string | null;
  spec_revision_id: string | null; qa_inspection_id: string | null; customer_accepted_at: string | null;
  as_built_closed_at: string | null; cancel_reason: string | null; abortive_cost_inr: number | null; owner_user_id: string | null;
  created_at: string; updated_at: string;
}

export interface CrItem {
  id: string; cr_id: string; room: string | null; trade: string | null; category_code: string; catalogue_item_id: string | null;
  description: string; qty: number; unit_price_inr: number; vendor_cost_inr: number; tax_pct: number; lead_days: number;
  gate_state_at_request: string | null; status: "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "REVERSED"; created_at: string;
}

export interface QuotationLine { item_id: string; description: string; qty: number; unit_price_inr: number; tax_pct: number; line_total_inr: number }
export interface Quotation {
  id: string; cr_id: string; version: number; lines: QuotationLine[];
  subtotal_inr: number; tax_inr: number; waiver_inr: number; total_inr: number; valid_until: string; issued_at: string; issued_by: string | null;
  status: "DRAFT" | "ISSUED" | "ACCEPTED" | "EXPIRED" | "SUPERSEDED" | "DECLINED"; pdf_file_key: string | null; document_id: string | null;
  customer_accepted_at: string | null; accepted_via: "PORTAL" | "SIGNED_COPY" | null;
}

export interface CrEconomics { cr_id: string; code: string; price_inr: number; vendor_cost_inr: number; tax_inr: number; waiver_inr: number; contribution_inr: number }
export interface CrApproval { id: string; cr_id: string; action_id: string; approver_role: string; decision: "PENDING" | "APPROVED" | "REJECTED"; decided_by: string | null }
export interface CrExecutionAction { action_id: string; kind: "SITE_WORK" | "PROCUREMENT" | "VENDOR" | "DRAWING_UPDATE" | "QA"; title: string; status: string }

export interface CrApprovalRule {
  id: string; project_id: string | null; kind: "VALUE" | "MARGIN" | "SCHEDULE" | "FREEZE" | "CATEGORY";
  category_code: string | null; threshold: number | null; approver_role: string; requires_second_approver: boolean;
  second_approver_role: string | null; effective_from: string; effective_to: string | null;
}
export interface CustomisationPolicy { freeze_dates: Record<string, string>; quotation_validity_days: number; payment_gate_pct: number; cancellation_terms: Record<string, unknown>; allowed_catalogue_only: boolean }
export interface CatalogueItem { id: string; project_id: string | null; category_code: string; code: string; name: string; description: string | null; unit_price_inr: number; vendor_cost_inr: number; lead_days: number; active: boolean }

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

export const changeRequestsApi = {
  list: (filter: { status?: string; project_id?: string; booking_id?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
    return req<ChangeRequest[]>(`/api/change-requests?${qs}`, "GET");
  },
  get: (id: string) => req<ChangeRequest>(`/api/change-requests/${id}`, "GET"),
  items: (id: string) => req<CrItem[]>(`/api/change-requests/${id}/items`, "GET"),
  quotation: (id: string) => req<Quotation>(`/api/quotations/${id}`, "GET"),
  raise: (bookingId: string, input: { title: string; summary?: string; primary_category_code?: string; raised_by_kind: "SALES" | "CRM" | "CUSTOMISATION" }) =>
    req<ChangeRequest>(`/api/bookings/${bookingId}/change-requests`, "POST", input),
  feasibility: (id: string, input: { result: "FEASIBLE" | "FEASIBLE_WITH_CONDITIONS" | "NOT_FEASIBLE"; technical_notes: string }) =>
    req<ChangeRequest>(`/api/change-requests/${id}/feasibility`, "POST", input),
  putItems: (id: string, items: Partial<CrItem>[]) => req<CrItem[]>(`/api/change-requests/${id}/items`, "PUT", { items }),
  setImpact: (id: string, input: ImpactInfo) => req<{ ok: true }>(`/api/change-requests/${id}/costing`, "POST", input),
  linkException: (id: string, exceptionId: string) => req<{ ok: true }>(`/api/change-requests/${id}/link-exception`, "POST", { exception_id: exceptionId }),
  submitForApproval: (id: string) => req<ChangeRequest>(`/api/change-requests/${id}/submit-approval`, "POST"),
  approvals: (id: string) => req<CrApproval[]>(`/api/change-requests/${id}/approvals`, "GET"),
  decideApproval: (actionId: string, decision: "APPROVE" | "REJECT", note?: string) => req<ChangeRequest>(`/api/change-request-approvals/${actionId}/decide`, "POST", { decision, note }),
  issueQuotation: (id: string) => req<Quotation>(`/api/change-requests/${id}/issue-quotation`, "POST"),
  acceptQuotation: (quotationId: string, acceptedVia: "PORTAL" | "SIGNED_COPY") => req<Quotation>(`/api/quotations/${quotationId}/accept`, "POST", { accepted_via: acceptedVia }),
  confirmPayment: (id: string) => req<ChangeRequest>(`/api/change-requests/${id}/confirm-payment`, "POST"),
  waivePayment: (id: string, reason: string) => req<ChangeRequest>(`/api/change-requests/${id}/waive-payment`, "POST", { reason }),
  release: (id: string) => req<ChangeRequest>(`/api/change-requests/${id}/release`, "POST"),
  executionActions: (id: string) => req<CrExecutionAction[]>(`/api/change-requests/${id}/execution-actions`, "GET"),
  closeExecutionAction: (actionId: string, note?: string) => req<ChangeRequest>(`/api/change-request-executions/${actionId}/close`, "POST", { note }),
  linkQaInspection: (id: string, qaInspectionId: string) => req<ChangeRequest>(`/api/change-requests/${id}/link-qa-inspection`, "POST", { qa_inspection_id: qaInspectionId }),
  qaVerify: (id: string) => req<ChangeRequest>(`/api/change-requests/${id}/qa-verify`, "POST"),
  customerAccept: (id: string) => req<ChangeRequest>(`/api/change-requests/${id}/customer-accept`, "POST"),
  asBuiltClose: (id: string, note?: string) => req<ChangeRequest>(`/api/change-requests/${id}/as-built-close`, "POST", { as_built_items: {}, note }),
  withdraw: (id: string) => req<ChangeRequest>(`/api/change-requests/${id}/withdraw`, "POST"),
  cancel: (id: string, reason: string, abortiveCostInr: number) => req<ChangeRequest & { refund_raised: boolean }>(`/api/change-requests/${id}/cancel`, "POST", { reason, abortive_cost_inr: abortiveCostInr }),
  economics: (id: string) => req<CrEconomics>(`/api/change-requests/${id}/economics`, "GET"),
  catalogue: (projectId: string) => req<CatalogueItem[]>(`/api/variation-catalogue?project_id=${projectId}`, "GET"),

  // Studio
  approvalRules: (projectId?: string | null) => req<CrApprovalRule[]>(`/api/cr-approval-rules${projectId ? `?project_id=${projectId}` : ""}`, "GET"),
  putApprovalRules: (projectId: string | null, rules: Omit<CrApprovalRule, "id" | "project_id">[]) => req<CrApprovalRule[]>(`/api/cr-approval-rules`, "PUT", { project_id: projectId, rules }),
  policy: (projectId: string) => req<CustomisationPolicy>(`/api/customisation-policy/${projectId}`, "GET"),
  putPolicy: (projectId: string, input: Partial<CustomisationPolicy>) => req<CustomisationPolicy>(`/api/customisation-policy/${projectId}`, "PUT", input),
};
