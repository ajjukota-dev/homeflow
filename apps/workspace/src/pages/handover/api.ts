// 16-handover-gates.md's API list. Same req/unwrap pattern as pages/finance/api.ts,
// pages/management/api.ts.
import { ApiError } from "../../auth/api";

export type GateType = "financial" | "legal" | "registration" | "physical" | "quality" | "commitments" | "customer" | "fm";
export type GateClass = "hard" | "soft";

export interface EvaluatedGate {
  type: GateType;
  classification: GateClass;
  state: "open" | "passed";
  blockers: string[];
  gate_db: string;
  overridden: boolean;
  override_id: string | null;
}

export interface ChecklistItem { done: boolean; by: string | null; at: string | null; file_ids: string[] }
export interface ChecklistRow {
  groups: Record<string, Record<string, ChecklistItem>>;
  customer_signature_file_id: string | null;
  company_signature_file_id: string | null;
  photos: string[];
}
export interface AppointmentRow {
  proposed_slots: string[];
  confirmed_slot: string | null;
  confirmed_by: "CUSTOMER_PORTAL" | "CRM_ON_BEHALF" | null;
  confirmed_at: string | null;
  attendees: Record<string, unknown>[];
  rescheduled_count: number;
  reschedule_reasons: { reason: string; at: string }[];
}

export interface HandoverCase {
  id: string; code: string; booking_id: string; unit_id: string; project_id: string;
  status: "NOT_STARTED" | "PREPARING" | "READY" | "SCHEDULED" | "COMPLETED" | "CLOSED";
  predicted_date: string | null; predicted_confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  completed_at: string | null; keys_issued_at: string | null;
}
export interface HandoverView {
  case: HandoverCase;
  unit_number: string;
  customer_name: string | null;
  gates: EvaluatedGate[];
  eligible: boolean;
  lifecycle: "eligible" | "at_risk" | "not_eligible";
  blockers: { gate: GateType; reason: string }[];
  checklist: ChecklistRow;
  appointment: AppointmentRow | null;
}

export interface GateConfigRow {
  id: string; gate: string; classification: "HARD" | "SOFT"; overridable: boolean; override_roles: string[];
  requires_approval: boolean; requires_evidence: boolean; project_id: string | null; effective_to: string | null; version: number;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

export const handoverApi = {
  getCase: (bookingId: string) => fetch(`/api/bookings/${bookingId}/handover`).then((r) => unwrap<HandoverView>(r)),
  evaluate: (bookingId: string) => fetch(`/api/handover/${bookingId}/evaluate`, { method: "POST" }).then((r) => unwrap<HandoverView>(r)),
  override: (bookingId: string, body: { gate: string; reason: string; evidence_file_ids?: string[]; approved_by_user_id?: string; valid_until?: string }) =>
    fetch(`/api/handover/${bookingId}/override`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => unwrap<HandoverView>(r)),
  proposeAppointment: (bookingId: string, slots: string[]) =>
    fetch(`/api/handover/${bookingId}/appointment/propose`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slots }) }).then((r) => unwrap<HandoverView>(r)),
  confirmAppointment: (bookingId: string, body: { slot: string; confirmed_by: "CUSTOMER_PORTAL" | "CRM_ON_BEHALF"; note?: string }) =>
    fetch(`/api/handover/${bookingId}/appointment/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => unwrap<HandoverView>(r)),
  rescheduleAppointment: (bookingId: string, body: { slot: string; reason: string }) =>
    fetch(`/api/handover/${bookingId}/appointment/reschedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => unwrap<HandoverView>(r)),
  updateChecklist: (bookingId: string, patch: Partial<ChecklistRow>) =>
    fetch(`/api/handover/${bookingId}/checklist`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then((r) => unwrap<HandoverView>(r)),
  complete: (bookingId: string) => fetch(`/api/handover/${bookingId}/complete`, { method: "POST" }).then((r) => unwrap<HandoverView>(r)),
  close: (bookingId: string) => fetch(`/api/handover/${bookingId}/close`, { method: "POST" }).then((r) => unwrap<HandoverView>(r)),
  pipeline: (projectId: string) => fetch(`/api/projects/${projectId}/handover-pipeline`).then((r) => unwrap<HandoverView[]>(r)),
  gateConfig: () => fetch(`/api/handover-gate-config`).then((r) => unwrap<GateConfigRow[]>(r)),
};

/** Project row overrides the standard (null) row — mirrors handover/store.ts::loadGateConfig's
 *  own resolution (most specific, latest effective row wins). Client-side only for deciding what
 *  the override dialog should ask for; the server re-validates regardless (rule 2). */
export function resolveGateConfig(rows: GateConfigRow[], projectId: string, gate: string): GateConfigRow | null {
  const candidates = rows.filter((r) => r.gate === gate && r.effective_to === null && (r.project_id === projectId || r.project_id === null));
  candidates.sort((a, b) => (a.project_id === null ? 1 : -1) - (b.project_id === null ? 1 : -1) || b.version - a.version);
  return candidates[0] ?? null;
}
