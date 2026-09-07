// 28-360-views.md §API. Same req/unwrap pattern as pages/documents/api.ts. `tabs[].api` is a
// generic same-origin GET URL into another spec's own endpoint (tab content is owned by its own
// spec, per this spec's "Not in this feature" line) — `fetchTabData` is the one generic reader
// every 360 tab uses to pull it, so this file never re-derives another module's shape.
import { ApiError } from "../../auth/api";

export interface TabManifestEntry { key: string; label: string; available: boolean; api: string | null; unavailable_reason?: string }

export type Trend = "UP" | "FLAT" | "DOWN";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export interface ScoreDriver { code: string; label: string; contribution: number; fact: string }
export interface ScoreAction { action_type: string; title: string; target?: string | null }
export interface Score { value: number; trend: Trend; drivers: ScoreDriver[]; confidence: Confidence; confidence_reason: string; actions: ScoreAction[] }

export interface Unit360View {
  unit_id: string; project_id: string; unit_number: string; unit_type: string; product_type: string; facing: string; sale_status: string;
  hierarchy_path: { kind: string; name: string }[];
  areas: { carpet_sqft: number | null; built_up_sqft: number | null; saleable_sqft: number | null; plot_sqyd: number | null };
  base_price_inr: number | null;
  current_booking: { id: string; booking_number: string; status: string } | null;
  readiness: Score;
  flexibility: Score;
  tabs: TabManifestEntry[];
}

export interface NextAction { id: string; title: string; status: string; priority: string; due_at: string | null; owner_role: string }
export interface Booking360View {
  booking_id: string; booking_number: string; status: string; project_id: string;
  unit: { id: string; unit_number: string; unit_type: string } | null;
  customer: { id: string; display_name: string } | null;
  booking_readiness: Score; handover_readiness: Score;
  next_actions: NextAction[];
  tabs: TabManifestEntry[];
}

export interface CustomerHealth { score: number; drivers: { label: string; delta: number }[] }
export interface Customer360View {
  customer_id: string; display_name: string; primary_phone: string | null; primary_email: string | null;
  kyc_status: string; residency: string; merged_into_customer_id: string | null;
  bookings: { id: string; booking_number: string; status: string; unit_number: string }[];
  applicants: { display_name: string; role: string; booking_number: string }[];
  merged_from: { id: string; display_name: string }[];
  commitments: { id: string; title: string; status: string; category: string; due_date: string | null }[];
  change_requests: { id: string; booking_id: string; status: string; title: string }[];
  health: CustomerHealth;
  tabs: TabManifestEntry[];
}

export interface ProjectHeaderView {
  project_id: string; code: string; name: string;
  product_mix: { product_type: string; sale_status: string; count: number }[];
  units_sold: number; units_available: number; units_total: number;
  true_risk_inr: number; open_material_escalations: number; unit_readiness_avg: number | null;
  next_month_forecast_inr: number | null; actual_to_date_inr: number | null;
  handovers_due_30d: null; handovers_due_30d_reason: string;
}

export interface RecentContext { last_project_id: string | null; last_entity_type: "unit" | "customer" | "booking" | null; last_entity_id: string | null }

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

export const threeSixtyApi = {
  getUnit360: (id: string) => req<Unit360View>(`/api/units/${id}/360`, "GET"),
  getCustomer360: (id: string) => req<Customer360View>(`/api/customers/${id}/360`, "GET"),
  getBooking360: (id: string) => req<Booking360View>(`/api/bookings/${id}/360`, "GET"),
  getProjectHeader: (id: string) => req<ProjectHeaderView>(`/api/projects/${id}/header`, "GET"),
  getMyContext: () => req<RecentContext>(`/api/me/context`, "GET"),
  setMyContext: (input: { project_id?: string | null; entity_type?: "unit" | "customer" | "booking" | null; entity_id?: string | null }) => req<RecentContext>(`/api/me/context`, "PUT", input),
  /** The one generic reader every tab-manifest entry uses (`tabs[].api`) — a same-origin GET
   *  whose shape is owned by the target spec, not known here. */
  fetchTabData: (url: string) => req<unknown>(url, "GET"),
};
