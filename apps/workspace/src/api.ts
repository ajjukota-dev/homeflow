// API client → local HomeFlow API (Vite proxies /api → http://localhost:3001).
// The same calls hit API Gateway on AWS by changing the base URL only.

import { lifecycleApi } from "./api-lifecycle";
import { eventsApi } from "./api-events";
import { modelApi } from "./api-model";

export type GateState = "OPEN" | "CLOSING" | "CONDITIONAL" | "EXCEPTION_ONLY" | "HARD_CLOSED";
export type ProgressState = "not_started" | "in_progress" | "complete" | "verified";

export interface Gate {
  category_code: string;
  customer_label: string;
  customer_visible: boolean;
  state: GateState;
  reason: string;
}
export interface UnitComponent {
  code: string;
  label: string;
  state_code: ProgressState;
}
export interface Unit {
  id: string;
  unit_number: string;
  unit_type: string;
  facing: string;
  sale_status: string;
  score: number;
  gates: Gate[];
  components?: UnitComponent[];
}

export interface DocItem {
  type: string;
  received: boolean;
}
export interface BookingInput {
  applicant: { display_name: string; phone: string; pan: string };
  total_consideration: number;
  docs: DocItem[];
}
export interface Booking {
  id: string;
  booking_number: string;
  status: string;
  total_consideration: number;
  completeness_score: number;
  unit_number: string;
  unit_type?: string;
  facing?: string;
  applicant_name?: string;
  applicant_phone?: string;
  return_reason?: string;
  rm_owner?: string;
}
export interface CustomerRow {
  id: string;
  display_name: string;
  primary_phone: string;
  kyc_status: string;
  booking_number: string;
  unit_number: string;
}
export interface Customer {
  id: string;
  display_name: string;
  primary_phone: string;
  kyc_status: string;
  bookings: {
    booking_id: string;
    booking_number: string;
    status: string;
    total_consideration: number;
    unit_number: string;
    unit_type: string;
    facing: string;
  }[];
}

export interface Project {
  id: string;
  code: string;
  name: string;
}

export type RiskBucket =
  | "DUE"
  | "OVERDUE"
  | "DISPUTED"
  | "LOAN_DEPENDENT"
  | "PROMISE_TO_PAY"
  | "TRUE_RISK";

export interface CollectionItem {
  demand_id: string;
  booking_id: string;
  customer_name: string;
  unit_number: string;
  milestone_label: string;
  amount: number;
  ageing_days: number;
  overdue_reason_code: string | null;
  next_action: string | null;
  bucket: RiskBucket;
}

export interface CollectionsView {
  outstanding_total: number;
  buckets: Record<RiskBucket, { amount: number; items: CollectionItem[] }>;
}

export interface OverdueReason {
  code: string;
  label: string;
  next_action: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()).data as T;
}

export const api = {
  listProjects: () => fetch("/api/projects").then((r) => json<Project[]>(r)),
  createProject: (body: { code: string; name: string }) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Project>(r)),
  createUnit: (projectId: string, body: { unit_number: string; unit_type: string; facing: string }) =>
    fetch(`/api/projects/${projectId}/units`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Unit>(r)),
  listUnits: (projectId?: string) =>
    fetch(`/api/units${projectId ? `?project_id=${projectId}` : ""}`).then((r) => json<Unit[]>(r)),
  getUnit: (id: string) => fetch(`/api/units/${id}`).then((r) => json<Unit>(r)),
  setProgress: (id: string, component_code: string, state_code: ProgressState) =>
    fetch(`/api/units/${id}/progress`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ component_code, state_code }),
    }).then((r) => json<Unit>(r)),

  bookingConfig: () => fetch("/api/booking-config").then((r) => json<{ mandatory_docs: string[] }>(r)),
  book: async (unitId: string, input: BookingInput): Promise<Booking> => {
    const res = await fetch(`/api/units/${unitId}/book`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json();
    if (!res.ok) {
      const err = new Error("incomplete") as Error & { missing?: string[] };
      err.missing = body.errors?.[0]?.missing;
      throw err;
    }
    return body.data as Booking;
  },
  listBookings: (status?: string) =>
    fetch(`/api/bookings${status ? `?status=${status}` : ""}`).then((r) => json<Booking[]>(r)),
  acceptBooking: (id: string) =>
    fetch(`/api/bookings/${id}/accept`, { method: "POST" }).then((r) =>
      json<{ booking: Booking; customer_id: string }>(r)
    ),
  returnBooking: (id: string, reason: string) =>
    fetch(`/api/bookings/${id}/return`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then((r) => json<Booking>(r)),
  listCustomers: () => fetch("/api/customers").then((r) => json<CustomerRow[]>(r)),
  getCustomer: (id: string) => fetch(`/api/customers/${id}`).then((r) => json<Customer>(r)),

  collections: (projectId: string) =>
    fetch(`/api/projects/${projectId}/collections`).then((r) => json<CollectionsView>(r)),
  overdueReasons: () => fetch("/api/overdue-reasons").then((r) => json<OverdueReason[]>(r)),
  postReceipt: (demandId: string, amount: number, idempotencyKey: string) =>
    fetch(`/api/demands/${demandId}/receipt`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ amount, mode: "neft", idempotency_key: idempotencyKey }),
    }).then((r) => json<unknown>(r)),
  recordPtp: (demandId: string, expected_date: string, expected_amount: number) =>
    fetch(`/api/demands/${demandId}/ptp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_date, expected_amount }),
    }).then((r) => json<unknown>(r)),
  ...lifecycleApi,
  ...eventsApi,
  ...modelApi,
};
