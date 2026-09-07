// 30-post-handover.md API. Same req/unwrap pattern as pages/communications/api.ts.
import { ApiError } from "../../auth/api";

export type CaseStatus = "ONBOARDING" | "IN_DLP" | "DLP_CLOSED" | "CLOSED";
export type WarrantyStatus = "open" | "triaged" | "assigned" | "in_progress" | "resolved" | "closed" | "rejected";
export type MoveInTaskKey =
  | "facility_intro_done" | "maintenance_setup_done" | "owner_record_transferred"
  | "warranties_shared" | "pending_snag_monitoring" | "utilities_transferred" | "association_membership";

export interface MoveInTaskState { done: boolean; action_id: string | null; by: string | null; at: string | null }
export type MoveInTasks = Record<MoveInTaskKey, MoveInTaskState>;

export interface PostHandoverCaseRow {
  id: string; booking_id: string; unit_id: string; project_id: string; handover_completed_at: string;
  move_in_tasks: MoveInTasks; status: CaseStatus; fm_owner_user_id: string | null;
}
export interface PostHandoverCaseListRow extends PostHandoverCaseRow {
  unit_number: string; customer_name: string | null; booking_number: string; open_warranty_cases: number;
}

export interface WarrantyCaseRow {
  id: string; unit_id: string; booking_id: string; project_id: string; passport_item_id: string | null;
  category: string; trade: string; severity: string; description: string; status: WarrantyStatus;
  raised_by_kind: string | null; in_coverage: boolean | null; coverage_basis: string | null;
  contractor_id: string | null; quote_inr: string | null; quote_accepted_at: string | null; waived_reason: string | null;
  cost_inr: string | null; sla_clock_id: string | null; customer_verified_at: string | null;
  before_file_keys: string[]; after_file_keys: string[]; rejected_reason: string | null; root_cause_code: string | null;
}

export interface PassportItem {
  id: string; kind: string | null; category: string; name: string; brand: string | null; model: string | null;
  serial: string | null; installed_on: string | null; warranty_until: string | null; vendor_contact: string | null; manual_file_id: string | null;
}

export interface ServiceHistoryRow {
  id: string; unit_id: string; event_type: string; kind: string | null; cost_inr: string | null;
  description: string; actor: string; occurred_at: string;
}

export interface DlpWindowStatus { category: string; months: number; ends_on: string; expired: boolean }
export interface CheckInRow { id: string; kind: string; sent_at: string; responded_at: string | null; score: number | null; comment: string | null }
export interface AdvocacyRow { id: string; booking_id: string; kind: "REFERRAL" | "TESTIMONIAL" | "REVIEW"; status: string; content: string | null; referred_prospect_id: string | null; at: string }
export interface Contractor { id: string; name: string; trade: string | null; contact: string | null; active: boolean }

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => unwrap<T>(r));
}
function put<T>(url: string, body?: unknown): Promise<T> {
  return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => unwrap<T>(r));
}

export const postHandoverApi = {
  listCases: (filter?: { project_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (filter?.project_id) qs.set("project_id", filter.project_id);
    if (filter?.status) qs.set("status", filter.status);
    const suffix = qs.toString() ? `?${qs}` : "";
    return fetch(`/api/post-handover-cases${suffix}`).then((r) => unwrap<PostHandoverCaseListRow[]>(r));
  },
  getCase: (bookingId: string) => fetch(`/api/bookings/${bookingId}/post-handover`).then((r) => unwrap<PostHandoverCaseRow>(r)),
  completeMoveInTask: (caseId: string, taskKey: MoveInTaskKey) => put<PostHandoverCaseRow>(`/api/post-handover/${caseId}/move-in-tasks`, { task_key: taskKey }),
  dlpWindows: (bookingId: string) => fetch(`/api/bookings/${bookingId}/dlp-windows`).then((r) => unwrap<DlpWindowStatus[]>(r)),
  checkIns: (bookingId: string) => fetch(`/api/bookings/${bookingId}/check-ins`).then((r) => unwrap<CheckInRow[]>(r)),

  warrantyCases: (filter: { unit_id?: string; booking_id?: string }) => {
    const qs = new URLSearchParams(filter as Record<string, string>);
    return fetch(`/api/warranty-cases?${qs}`).then((r) => unwrap<WarrantyCaseRow[]>(r));
  },
  createWarrantyCase: (input: { unit_id: string; booking_id: string; category: string; trade: string; severity: string; description: string; raised_by_kind?: string }) =>
    post<WarrantyCaseRow>("/api/warranty-cases", input),
  triage: (id: string) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/triage`),
  assign: (id: string, contractorId: string) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/assign`, { contractor_id: contractorId }),
  quote: (id: string, quoteInr: number) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/quote`, { quote_inr: quoteInr }),
  acceptQuote: (id: string) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/accept-quote`),
  waiveQuote: (id: string, reason: string) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/waive-quote`, { reason }),
  start: (id: string, beforeFileKeys?: string[]) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/start`, { before_file_keys: beforeFileKeys ?? [] }),
  resolve: (id: string, input: { cost_inr?: number | null; root_cause_code?: string | null }) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/resolve`, input),
  verify: (id: string) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/verify`),
  close: (id: string) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/close`),
  reject: (id: string, reason: string) => post<WarrantyCaseRow>(`/api/warranty-cases/${id}/reject`, { reason }),

  passport: (unitId: string) => fetch(`/api/units/${unitId}/passport`).then((r) => unwrap<PassportItem[]>(r)),
  putPassportItem: (unitId: string, input: Partial<PassportItem> & { kind: string; category: string; name: string }) => put<{ id: string }>(`/api/units/${unitId}/passport`, input),
  serviceHistory: (unitId: string) => fetch(`/api/units/${unitId}/service-history`).then((r) => unwrap<ServiceHistoryRow[]>(r)),
  addServiceRecord: (input: { unit_id: string; kind: string; description: string; cost_inr?: number | null; warranty_case_id?: string | null }) => post<{ id: string }>("/api/service-records", input),

  advocacy: (bookingId: string) => fetch(`/api/bookings/${bookingId}/advocacy`).then((r) => unwrap<AdvocacyRow[]>(r)),
  inviteAdvocacy: (bookingId: string, kind: "REFERRAL" | "TESTIMONIAL" | "REVIEW") => post<AdvocacyRow>("/api/advocacy/invite", { booking_id: bookingId, kind }),
  respondAdvocacy: (id: string, input: { status: string; content?: string | null; referred_prospect_name?: string | null }) => put<AdvocacyRow>(`/api/advocacy/${id}`, input),

  contractors: () => fetch("/api/contractors").then((r) => unwrap<Contractor[]>(r)),
};

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  ONBOARDING: "Onboarding", IN_DLP: "In DLP", DLP_CLOSED: "DLP closed", CLOSED: "Closed",
};
export const WARRANTY_STATUS_LABEL: Record<WarrantyStatus, string> = {
  open: "Open", triaged: "Triaged", assigned: "Assigned", in_progress: "In progress",
  resolved: "Resolved", closed: "Closed", rejected: "Rejected",
};
export const MOVE_IN_TASK_LABEL: Record<MoveInTaskKey, string> = {
  facility_intro_done: "Facility introduction walkthrough",
  maintenance_setup_done: "Maintenance setup",
  owner_record_transferred: "Owner record transferred",
  warranties_shared: "Warranties shared with customer",
  pending_snag_monitoring: "Pending snag monitoring set up",
  utilities_transferred: "Utilities transferred",
  association_membership: "Association membership",
};
export const CHECKIN_KIND_LABEL: Record<string, string> = {
  DAY_7: "Day 7", DAY_30: "Day 30", DAY_90: "Day 90", DLP_CLOSE: "DLP close",
};
