// Promise Ledger client (13-promise-ledger.md). Same req/unwrap pattern as pages/journey/api.ts.
import { ApiError } from "../../auth/api";

export type CommitmentCategory = "MODIFICATION" | "COMMERCIAL" | "TIMELINE" | "COMPLIMENTARY_ITEM" | "SPECIFICATION_UPGRADE" | "SERVICE" | "OTHER";
export type CommitmentSource = "SALES_HANDOVER" | "CRM" | "MANAGEMENT" | "COMMUNICATION" | "CHANGE_REQUEST";
export type CommitmentStatus = "DRAFT" | "APPROVED" | "ACTIVE" | "AT_RISK" | "FULFILLED" | "BREACHED" | "WAIVED_CANCELLED";
export type BreachRootCause = "DEPENDENCY" | "RESOURCE" | "VENDOR" | "SCOPE_MISUNDERSTOOD" | "OVERPROMISED" | "CUSTOMER" | "FORCE_MAJEURE";

export interface Commitment {
  id: string;
  code: string;
  project_id: string;
  booking_id: string;
  customer_id: string | null;
  unit_id: string;
  category: CommitmentCategory;
  description: string;
  committed_by_user_id: string;
  committed_at: string;
  source: CommitmentSource;
  beneficiary: "CUSTOMER" | "INTERNAL";
  customer_facing: boolean;
  owner_user_id: string | null;
  responsible_department: string | null;
  due_date: string | null;
  financial_impact_inr: number | null;
  approval_required: boolean;
  approved_by: string | null;
  approved_at: string | null;
  status: CommitmentStatus;
  at_risk_reason: string | null;
  fulfilled_at: string | null;
  fulfilled_evidence_file_ids: string[];
  customer_confirmed_at: string | null;
  crm_confirmation_note: string | null;
  breached_at: string | null;
  breach_root_cause: BreachRootCause | null;
  waived_reason: string | null;
  recovery_plan: string | null;
  recovery_due_date: string | null;
  depends_on: { type: string; id: string }[];
  confidence: number;
  confidence_drivers: { label: string; delta: number }[];
}

export interface CommitmentDetail extends Commitment {
  transitions: { id: string; from_status: string; to_status: string; at: string; actor_user_id: string | null; reason: string | null }[];
}

export interface CreateCommitmentInput {
  booking_id: string;
  category: CommitmentCategory;
  description: string;
  source: CommitmentSource;
  beneficiary: "CUSTOMER" | "INTERNAL";
  customer_facing: boolean;
  owner_user_id?: string | null;
  responsible_department?: string | null;
  due_date?: string | null;
  financial_impact_inr?: number | null;
  approval_required: boolean;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => unwrap<T>(r));
}

export const commitmentsApi = {
  list: (filters: { project_id?: string; status?: string; owner?: string; department?: string }) => {
    const params = new URLSearchParams();
    if (filters.project_id) params.set("project_id", filters.project_id);
    if (filters.status) params.set("status", filters.status);
    if (filters.owner) params.set("owner", filters.owner);
    if (filters.department) params.set("department", filters.department);
    const qs = params.toString();
    return req<Commitment[]>("GET", `/api/commitments${qs ? `?${qs}` : ""}`);
  },
  forBooking: (bookingId: string) => req<Commitment[]>("GET", `/api/bookings/${bookingId}/commitments`),
  get: (id: string) => req<CommitmentDetail>("GET", `/api/commitments/${id}`),
  create: (input: CreateCommitmentInput) => req<Commitment>("POST", "/api/commitments", input),
  approve: (id: string) => req<Commitment>("POST", `/api/commitments/${id}/approve`),
  activate: (id: string) => req<Commitment>("POST", `/api/commitments/${id}/activate`),
  fulfil: (id: string, input: { evidence_file_ids: string[]; customer_confirmed_at?: string | null; crm_confirmation_note?: string | null }) =>
    req<Commitment>("POST", `/api/commitments/${id}/fulfil`, input),
  waive: (id: string, reason: string) => req<Commitment>("POST", `/api/commitments/${id}/waive`, { reason }),
  setAtRisk: (id: string, reason: string) => req<Commitment>("POST", `/api/commitments/${id}/set-at-risk`, { reason }),
  recordRecoveryPlan: (id: string, recovery_plan: string, recovery_due_date: string) =>
    req<Commitment>("POST", `/api/commitments/${id}/recovery-plan`, { recovery_plan, recovery_due_date }),
  recordRootCause: (id: string, breach_root_cause: BreachRootCause) => req<Commitment>("POST", `/api/commitments/${id}/root-cause`, { breach_root_cause }),
};
