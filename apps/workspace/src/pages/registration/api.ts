// 23-registration.md §API. Same req/unwrap pattern as pages/documents/api.ts. Every route's `:id`
// is the booking_id, not the registration_case's own row id (registration/store.ts's own naming,
// matching GET /api/bookings/:id/registration) — every method here takes bookingId, not caseId.
//
// registration_case rows carry only booking_id/unit_id, never a joined unit_number/booking_number/
// customer_name (registration/store.ts's REG_SELECT has no such join) — screens must resolve those
// labels themselves from documentsApi.bookings(), never render a raw id (CLAUDE.md WCAG/UI bar).
import { ApiError } from "../../auth/api";

export type RegStatus =
  | "NOT_READY" | "READINESS_IN_PROGRESS" | "READY" | "AVAILABILITY_CONFIRMED"
  | "SLOT_BOOKED" | "EXECUTED" | "COMPLETED" | "CANCELLED";

export interface ReadinessFact { ok: boolean; fact: string }
export interface Readiness {
  documents: ReadinessFact; clearance: ReadinessFact; tds: ReadinessFact; agreement_executed: ReadinessFact;
  sale_deed_ready: ReadinessFact; customer_availability: ReadinessFact; signatories: ReadinessFact; poa_valid: ReadinessFact;
}
export const READINESS_KEYS = ["documents", "clearance", "tds", "agreement_executed", "sale_deed_ready", "signatories", "poa_valid", "customer_availability"] as const;

export interface SlotHistoryEntry { from: string | null; to: string; reason: string; by: string | null; at: string }

export interface RegCase {
  id: string; code: string; booking_id: string; unit_id: string; project_id: string;
  status: RegStatus; forecast_date: string | null; forecast_confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  readiness: Readiness; proposed_availability_dates: string[] | null; sro_office: string | null;
  slot_datetime: string | null; slot_reference: string | null; slot_history: SlotHistoryEntry[];
  day_of_checklist: Record<string, boolean>; executed_on: string | null; registration_document_number: string | null;
  company_representative: string | null; customer_attendees: Record<string, unknown>[] | null;
  registered_deed_file_id: string | null; stamp_duty_inr: number | null; registration_fee_inr: number | null;
  outcome_notes: string | null; owner_user_id: string | null; sro_reference: string | null; completed_at: string | null;
  escalation_needed?: boolean;
}

export interface ChecklistItem { key: string; label: string }
export interface ChecklistTemplate {
  id: string; project_id: string | null; jurisdiction: string | null;
  pre_items: ChecklistItem[]; day_of_items: ChecklistItem[]; sro_offices: string[]; jurisdiction_lead_days: number;
}

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

export const registrationApi = {
  get: (bookingId: string) => req<RegCase>(`/api/bookings/${bookingId}/registration`, "GET"),
  pipeline: (projectId: string) => req<RegCase[]>(`/api/projects/${projectId}/registration-pipeline`, "GET"),
  confirmAvailability: (bookingId: string, dates: string[]) => req<RegCase>(`/api/registration/${bookingId}/confirm-availability`, "POST", { dates }),
  bookSlot: (bookingId: string, input: { sro_office: string; slot_datetime: string; reference: string }) => req<RegCase>(`/api/registration/${bookingId}/book-slot`, "POST", input),
  reschedule: (bookingId: string, input: { slot_datetime: string; reason: string }) => req<RegCase>(`/api/registration/${bookingId}/reschedule`, "POST", input),
  updateDayOfChecklist: (bookingId: string, patch: Record<string, boolean>) => req<RegCase>(`/api/registration/${bookingId}/day-of-checklist`, "PUT", patch),
  execute: (bookingId: string, input: { executed_on: string; registration_document_number?: string; company_representative?: string; stamp_duty_inr?: number; registration_fee_inr?: number; outcome_notes?: string }) =>
    req<RegCase>(`/api/registration/${bookingId}/execute`, "POST", input),
  complete: (bookingId: string, input: { deed_document_id: string; sro_reference: string }) => req<RegCase>(`/api/registration/${bookingId}/complete`, "POST", input),

  // Studio
  listChecklistTemplates: () => req<ChecklistTemplate[]>(`/api/registration-checklist-templates`, "GET"),
  putChecklistTemplate: (input: { project_id?: string | null; jurisdiction?: string | null; pre_items: ChecklistItem[]; day_of_items: ChecklistItem[]; sro_offices: string[]; jurisdiction_lead_days: number }) =>
    req<ChecklistTemplate>(`/api/registration-checklist-templates`, "PUT", input),
};
