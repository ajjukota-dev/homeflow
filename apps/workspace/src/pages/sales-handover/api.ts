// Sales -> CRM handover client (17-sales-crm-handover.md). Same req/unwrap pattern as
// pages/commitments/api.ts. `submit` doubles as save-draft (services/api/src/sales-handover/
// core.ts always persists the packet/score first, even when it then throws gate_blocked) -
// there is no separate PUT endpoint in this backend-only slice.
import { ApiError } from "../../auth/api";

export type Residency = "RESIDENT" | "NRI" | "OCI";
export type HandoverStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "ACCEPTED";

export interface HandoverPacket {
  customer_section: {
    display_name: string | null;
    phone: string | null;
    pan: string | null;
    residency: Residency;
    applicant_details_confirmed: boolean;
    contact_verified: boolean;
    nri_status_confirmed: boolean;
    communication_pref_confirmed: boolean;
  };
  commercial_section: {
    final_price_inr: number | null;
    discount_inr: number;
    brokerage: number;
    payment_plan_ref: string | null;
    booking_amount_inr: number | null;
    approved_deviations: { domain: "DISCOUNT" | "BROKERAGE"; approver: string; ref: string }[];
  };
  unit_section: {
    unit_number: string | null;
    unit_type: string | null;
    facing: string | null;
    product_type: string | null;
    unit_confirmed: boolean;
    facing_confirmed: boolean;
    parking_confirmed: boolean;
  };
  documents_section: { type: string; received: boolean }[];
  commitments_section: HandoverCommitmentInput[];
}

export interface HandoverCommitmentInput {
  category: string;
  description: string;
  due_date: string;
  financial_impact_inr?: number | null;
  beneficiary: "CUSTOMER" | "INTERNAL";
  customer_facing: boolean;
}

export interface ChecklistItemResult {
  item_code: string;
  kind: "FIELD" | "DOCUMENT" | "CONFIRMATION" | "APPROVAL";
  required: boolean;
  weight: number;
  satisfied: boolean;
}

export interface SalesHandover {
  id: string;
  booking_id: string;
  project_id: string;
  status: HandoverStatus;
  version: number;
  packet: HandoverPacket;
  completeness_score: number | null;
  completeness_detail: ChecklistItemResult[] | null;
  submitted_by: string | null;
  submitted_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_reason_code: string | null;
  return_note: string | null;
  first_time_right: boolean | null;
}

export interface SubmitHandoverInput {
  residency?: Residency;
  confirmations?: Partial<{
    applicant_details_confirmed: boolean;
    contact_verified: boolean;
    nri_status_confirmed: boolean;
    communication_pref_confirmed: boolean;
    unit_confirmed: boolean;
    facing_confirmed: boolean;
    parking_confirmed: boolean;
  }>;
  commercial?: { discount_inr?: number; brokerage?: number; payment_plan_ref?: string | null };
  commitments?: HandoverCommitmentInput[];
}

export interface HandoverQueueRow {
  booking_id: string;
  booking_number: string;
  completeness_score: number | null;
  age_days: number;
  sales_owner: string | null;
}

export interface ReturnReason {
  code: string;
  label: string;
  category: string;
}

export class HandoverBlockedError extends ApiError {
  blockers: string[];
  constructor(blockers: string[]) {
    super("gate_blocked", "Missing required items before this can be submitted.");
    this.blockers = blockers;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    if (first.code === "gate_blocked") throw new HandoverBlockedError(first.blockers ?? []);
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

export const salesHandoverApi = {
  get: (bookingId: string) => req<SalesHandover>("GET", `/api/bookings/${bookingId}/sales-handover`),
  submit: (bookingId: string, input: SubmitHandoverInput) => req<SalesHandover>("POST", `/api/bookings/${bookingId}/sales-handover/submit`, input),
  accept: (bookingId: string) => req<SalesHandover>("POST", `/api/bookings/${bookingId}/sales-handover/accept`),
  return: (bookingId: string, reason_code: string, note: string) => req<SalesHandover>("POST", `/api/bookings/${bookingId}/sales-handover/return`, { reason_code, note }),
  queue: (projectId: string) => req<HandoverQueueRow[]>("GET", `/api/crm/handover-queue?project_id=${projectId}`),
  returnReasons: () => req<ReturnReason[]>("GET", "/api/return-reasons"),
};
