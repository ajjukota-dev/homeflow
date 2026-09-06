// Typed client for 26-customer-portal.md's `/api/portal/*` API — every shape here mirrors
// services/api/src/portal/core.ts's actual return type exactly (read alongside it, not guessed).
import { ApiError } from "./auth/api";

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function get<T>(url: string): Promise<T> {
  return fetch(url).then((r) => unwrap<T>(r));
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) =>
    unwrap<T>(r)
  );
}

export interface JourneyStage {
  label: string;
  status: string;
  expected_window: string | null;
}
export interface JourneyAction {
  id: string;
  title: string;
  due_date: string | null;
}
export interface Journey {
  stages: JourneyStage[];
  actions_required: JourneyAction[];
}

export interface Overview {
  project_name: string;
  unit_number: string;
  next_action: JourneyAction | null;
  latest_update: { id: string; title: string; body: string; published_at: string } | null;
  journey_strip: JourneyStage[];
}

export interface AsBuiltItem {
  category: string;
  spec: string;
  brand_model: string | null;
}
export interface MyHome {
  project_name: string;
  unit_number: string;
  unit_type: string;
  facing: string;
  as_built_spec: AsBuiltItem[];
  drawings: never[];
}

export interface PaymentLine {
  milestone_label: string;
  amount: number;
  due_date: string | null;
  status: string;
  why_now: string;
}
export interface Payments {
  schedule: PaymentLine[];
  paid_total: number;
  remaining_total: number;
  receipts: { receipt_id: string; amount: number; date: string }[];
  next_due: { milestone_label: string; amount: number; due_date: string | null } | null;
  tds: { status: string; amount: number | null }[];
  loan_summary: { lender: string | null; stage: string; sanctioned_amount_inr: number | null } | null;
  statement_pdf: null;
}

export interface RequiredDocument {
  id: string;
  label: string;
  status: string;
}
export interface DraftDocument {
  id: string;
  family: string;
  comments: { note: string; reason: string }[];
}
export interface ExecutedDocument {
  id: string;
  label: string;
  checksum: string | null;
  generated_at: string;
}
export interface Documents {
  required_from_you: RequiredDocument[];
  for_your_review: DraftDocument[];
  executed: ExecutedDocument[];
}

export interface RegistrationArea {
  status: string;
  proposed_dates: string[];
  slot: string | null;
  sro_office: string | null;
  outstanding: string[];
}

export interface HandoverArea {
  status: string;
  proposed_slots: string[];
  confirmed_slot: string | null;
  checklist_summary: { group: string; done: number; total: number }[];
  possession_letter_ready: boolean;
}

export interface CustomerRequest {
  id: string;
  code: string;
  title: string;
  status: string;
  raised_at: string;
  quotation: { id: string; total_inr: number; status: string; valid_until: string | null } | null;
}
export interface RequestsArea {
  requests: CustomerRequest[];
  raisable_categories: { code: string; label: string }[];
  snags: { location: string; trade: string; severity: string; status: string }[];
  service_requests: never[];
}

export interface Commitment {
  description: string;
  promised_date: string | null;
  status: string;
}

export interface PassportEquipmentItem {
  type: string;
  name: string;
  brand_model: string | null;
  paint_tile_code: string | null;
  warranty_months: number | null;
}
export interface Passport {
  equipment: PassportEquipmentItem[];
  as_built_spec: AsBuiltItem[];
  service_history: { event_type: string; description: string; occurred_at: string }[];
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_ref: { entity_type: string; entity_id: string } | null;
  read_at: string | null;
}

export interface CustomerUpdate {
  id: string;
  kind: string;
  title: string;
  body: string;
  published_at: string;
}

export const portalApi = {
  overview: () => get<Overview>("/api/portal/me"),
  journey: () => get<Journey>("/api/portal/journey"),
  myHome: () => get<MyHome>("/api/portal/my-home"),
  payments: () => get<Payments>("/api/portal/payments"),
  documents: () => get<Documents>("/api/portal/documents"),
  // Mirrors portal/core.ts::uploadCustomerDocument's real return shape (delegates to 22's
  // uploadDocument): { document, key, upload: { url, method, headers } } — the caller must then
  // actually PUT the file bytes to `upload.url`, or the document row asserts a file that was
  // never sent (found live 2026-09-07: an earlier version of this client called this endpoint
  // with no file at all and never followed up with the PUT).
  uploadDocument: (id: string, contentType: string) =>
    post<{ upload: { url: string; method: "PUT"; headers?: Record<string, string> } }>(`/api/portal/documents/${id}/upload`, { content_type: contentType }),
  registration: () => get<RegistrationArea | null>("/api/portal/registration"),
  confirmRegistration: (dates: string[]) => post<RegistrationArea | null>("/api/portal/registration/confirm", { dates }),
  handover: () => get<HandoverArea | null>("/api/portal/handover"),
  confirmHandoverAppointment: (slot: string) => post<HandoverArea | null>("/api/portal/handover/appointment/confirm", { slot }),
  rescheduleHandoverAppointment: (slot: string, reason: string) => post<HandoverArea | null>("/api/portal/handover/appointment/reschedule", { slot, reason }),
  requests: () => get<RequestsArea>("/api/portal/requests"),
  // Field names mirror change-requests/capture.ts's RaiseCrInput exactly (minus booking_id/
  // raised_by_kind, which portal/core.ts's raiseCustomerRequest now injects server-side) — an
  // earlier version of this client used category_code/description, which the backend silently
  // ignores (req.body is untyped `any`), landing every portal-raised request with a null
  // primary_category_code and breaking 18 rule 1's gate-based routing (found live 2026-09-07).
  raiseRequest: (input: { primary_category_code: string; title: string; summary?: string }) =>
    post<{ id: string; code: string; status: string }>("/api/portal/requests", input),
  acceptQuotation: (id: string) => post<{ id: string; status: string }>(`/api/portal/requests/quotations/${id}/accept`),
  commitments: () => get<Commitment[]>("/api/portal/commitments"),
  passport: () => get<Passport>("/api/portal/passport"),
  updates: () => get<CustomerUpdate[]>("/api/portal/updates"),
  submitCheckIn: (id: string, score: number, comment?: string) => post<{ ok: boolean }>(`/api/portal/check-ins/${id}`, { score, comment }),
  // Not a /api/portal/* route — 12-escalations-notifications.md's generic per-user feed, already
  // customer-readable (seed/permissions.ts's CUSTOMER_MODULES grants "notifications": "READ", and
  // the handler itself only ever filters by ctx.actor.user_id, no role gate). Used here only to
  // find a pending check_in.sent prompt (rule 10) — no bespoke "list my pending check-ins"
  // endpoint exists, and this is the entity_ref that now carries the check-in id (2026-09-07 fix).
  unreadNotifications: () => get<NotificationRow[]>("/api/notifications?unread=true"),
  markNotificationRead: (id: string) => post<{ ok: boolean }>(`/api/notifications/${id}/read`),
};
