// 24-sales-inventory-discovery.md's API list, real shapes from services/api/src/sales/**.
import { ApiError } from "../../auth/api";
import type { GateState } from "../../ui/GateChip";

export type Importance = "MUST_HAVE" | "PREFERRED" | "NOT_IMPORTANT";
export type Residency = "RESIDENT" | "NRI" | "OCI";

export interface GateChipData {
  category_code: string;
  customer_label: string;
  state: GateState;
  display_state: GateState;
  reason: string;
  expected_close_at: string | null;
  freshness_status: "FRESH" | "VERIFICATION_REQUIRED";
  source_at: string;
  held_until: string | null;
}

export interface PossessionWindow { from: string; to: string; anchor: string; confidence: "HIGH" | "MEDIUM" | "LOW"; basis: string }

export interface InventoryUnit {
  unit_id: string;
  unit_number: string;
  unit_type: string;
  facing: string;
  product_type: string;
  hierarchy_node_id: string;
  sale_status: string;
  price_inr: number | null;
  carpet_area_sqft: number | null;
  saleable_area_sqft: number | null;
  construction_pct: number;
  expected_possession_window: PossessionWindow | null;
  flexibility: { value: number; drivers: { code: string; label: string; contribution: number; fact: string }[]; confidence: string };
  gates: GateChipData[];
  closing_soon: boolean;
  ready_to_move: boolean;
  freshness: "FRESH" | "VERIFICATION_REQUIRED";
  filters: string[];
}

export interface MatchExplanation { category: string; importance: Importance; gate_state: GateState; verdict: string; text: string }
export interface UnitMatch { score: number; explanation: MatchExplanation[]; disclaimer: string; stale_inputs: boolean }

export interface CompareResult {
  units: (InventoryUnit & { match: UnitMatch | null })[];
  disclaimer: string | null;
}

export interface ProspectNeed { category_code: string; importance: Importance; note?: string | null }

export interface Prospect {
  id: string; code: string; project_id: string; name: string; phone: string | null; email: string | null; source: string | null;
  sales_owner_user_id: string | null; status: "ACTIVE" | "BOOKED" | "LOST"; lost_reason: string | null; customer_id: string | null; created_at: string;
}

export interface StoredMatch { prospect_id: string; unit_id: string; score: number; explanation: MatchExplanation[]; disclaimer: string; computed_at: string; freshness: "FRESH" | "STALE" | "VERIFICATION_REQUIRED" }

export interface Hold {
  id: string; code: string; unit_id: string; project_id: string; category_code: string; prospect_id: string | null; booking_id: string | null;
  requested_by: string; reason: string; requested_until: string; approved_by: string | null; approved_until: string | null; decision_note: string | null;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "EXPIRED" | "RELEASED" | "CONSUMED"; policy_id: string | null; created_at: string; closed_at: string | null;
}

export interface HoldPolicy {
  id: string | null; project_id: string | null; max_days: number; max_active_per_project: number;
  allowed_categories: string[] | null; approver_role: string; auto_expire: boolean;
}

export interface BookingCreated {
  booking_id: string; code: string; status: string; unit_id: string; prospect_id: string; agreement_value_inr: number;
  discount_inr: number; approval_action_id: string | null; consumed_hold_ids: string[]; personalisation_context: unknown[];
}

export interface ApplicantInput {
  display_name: string; phone?: string | null; email?: string | null; pan?: string | null; residency: Residency; role?: "PRIMARY" | "CO_APPLICANT";
}

export interface PaymentPlan { id: string; project_id: string | null; name: string; basis: string }

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

export const salesApi = {
  inventory: (projectId: string, opts: { node_id?: string; sale_status?: string; facing?: string; min_price?: number; max_price?: number; filters?: string[]; sort?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.node_id) qs.set("node_id", opts.node_id);
    if (opts.sale_status) qs.set("sale_status", opts.sale_status);
    if (opts.facing) qs.set("facing", opts.facing);
    if (opts.min_price !== undefined) qs.set("min_price", String(opts.min_price));
    if (opts.max_price !== undefined) qs.set("max_price", String(opts.max_price));
    if (opts.sort) qs.set("sort", opts.sort);
    if (opts.filters?.length) qs.set("filters", opts.filters.join(","));
    return fetch(`/api/projects/${projectId}/inventory?${qs}`).then((r) => unwrap<InventoryUnit[]>(r));
  },
  compare: (unitIds: string[], prospectId?: string) => {
    const qs = new URLSearchParams();
    qs.set("unit_ids", unitIds.join(","));
    if (prospectId) qs.set("prospect_id", prospectId);
    return fetch(`/api/inventory/compare?${qs}`).then((r) => unwrap<CompareResult>(r));
  },
  listProspects: (projectId: string, status?: string) => {
    const qs = new URLSearchParams({ project_id: projectId });
    if (status) qs.set("status", status);
    return fetch(`/api/prospects?${qs}`).then((r) => unwrap<Prospect[]>(r));
  },
  createProspect: (input: { project_id: string; name: string; phone?: string | null; email?: string | null; source?: string | null }) =>
    fetch("/api/prospects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) => unwrap<Prospect>(r)),
  getProspect: (id: string) => fetch(`/api/prospects/${id}`).then((r) => unwrap<Prospect & { needs: ProspectNeed[] }>(r)),
  putNeeds: (id: string, needs: ProspectNeed[]) =>
    fetch(`/api/prospects/${id}/needs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ needs }) }).then((r) => unwrap<ProspectNeed[]>(r)),
  getMatches: (id: string, unitIds?: string[]) => {
    const qs = unitIds?.length ? `?unit_ids=${unitIds.join(",")}` : "";
    return fetch(`/api/prospects/${id}/matches${qs}`).then((r) => unwrap<StoredMatch[]>(r));
  },
  markLost: (id: string, reason: string) =>
    fetch(`/api/prospects/${id}/lost`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }).then((r) => unwrap<Prospect>(r)),
  book: (prospectId: string, input: { unit_id: string; applicants: ApplicantInput[]; price_inr: number; discount_inr?: number; booking_amount_inr?: number; payment_plan_id?: string | null }) =>
    fetch(`/api/prospects/${prospectId}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) => unwrap<BookingCreated>(r)),
  confirmBooking: (bookingId: string) => fetch(`/api/bookings/${bookingId}/confirm-inventory`, { method: "POST" }).then((r) => unwrap<{ status: string }>(r)),

  listHolds: (projectId: string, status?: string) => {
    const qs = new URLSearchParams({});
    if (status) qs.set("status", status);
    return fetch(`/api/projects/${projectId}/holds?${qs}`).then((r) => unwrap<Hold[]>(r));
  },
  requestHold: (input: { unit_id: string; category_code: string; prospect_id?: string | null; reason: string; requested_until: string }) =>
    fetch("/api/holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) => unwrap<Hold>(r)),
  approveHold: (id: string, input: { approved_until?: string; note?: string } = {}) =>
    fetch(`/api/holds/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) => unwrap<Hold>(r)),
  rejectHold: (id: string, note?: string) =>
    fetch(`/api/holds/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }).then((r) => unwrap<Hold>(r)),
  releaseHold: (id: string, reason: string) =>
    fetch(`/api/holds/${id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }).then((r) => unwrap<Hold>(r)),

  getHoldPolicy: (projectId: string | null) => fetch(`/api/hold-policy${projectId ? `?project_id=${projectId}` : ""}`).then((r) => unwrap<HoldPolicy>(r)),
  putHoldPolicy: (input: Partial<HoldPolicy> & { project_id?: string | null }) =>
    fetch("/api/hold-policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) => unwrap<HoldPolicy>(r)),

  listPaymentPlans: () => fetch("/api/payment-plans").then((r) => unwrap<PaymentPlan[]>(r)),
};
