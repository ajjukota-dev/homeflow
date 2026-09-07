// 29-communications.md API. Same req/unwrap pattern as pages/site/api.ts.
import { ApiError } from "../../auth/api";

export type Channel = "CALL" | "EMAIL" | "WHATSAPP" | "SMS" | "MEETING" | "NOTICE" | "PORTAL_UPDATE";
export type Direction = "INBOUND" | "OUTBOUND";
export type Visibility = "INTERNAL" | "CUSTOMER_VISIBLE";
export type TemplatePurpose = "WELCOME" | "PAYMENT_REMINDER" | "MILESTONE" | "DOCUMENT_REQUEST" | "APPOINTMENT" | "DELAY_NOTICE" | "CUSTOMISATION_QUOTE" | "HANDOVER_INVITE" | "CHECK_IN" | "GENERAL";
export type TemplateStatus = "DRAFT" | "LEGAL_REVIEW" | "APPROVED" | "RETIRED";

export interface CommunicationRow {
  id: string; code: string; customer_id: string; booking_id: string | null; project_id: string | null;
  channel: Channel; direction: Direction; visibility: Visibility; subject: string | null; body: string;
  template_id: string | null; occurred_at: string; logged_by: string | null;
  follow_up_required: boolean; follow_up_due: string | null; follow_up_action_id: string | null;
  attachments: string[]; linked_entity: { entity_type: string; entity_id: string } | null;
  published_to_portal_at: string | null; customer_update_id: string | null;
}

export interface CommunicationTemplateRow {
  id: string; code: string; channel: Channel; purpose: TemplatePurpose; subject: string | null; body: string;
  project_id: string | null; version: number; status: TemplateStatus; approved_by: string | null; approved_at: string | null; created_at: string;
}

export interface GuardrailStatus { blocked: boolean; purpose: string | null; sent: number; max: number | null; window_days: number | null }

export interface InternalNoteRow { id: string; entity_type: string; entity_id: string; body: string; author_user_id: string; author_name: string | null; mentions: string[]; created_at: string }

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

export const communicationsApi = {
  listForCustomer: (customerId: string, filter?: { channel?: string; visibility?: string }) => {
    const qs = new URLSearchParams();
    if (filter?.channel) qs.set("channel", filter.channel);
    if (filter?.visibility) qs.set("visibility", filter.visibility);
    const suffix = qs.toString() ? `?${qs}` : "";
    return fetch(`/api/customers/${customerId}/communications${suffix}`).then((r) => unwrap<CommunicationRow[]>(r));
  },
  log: (input: { customer_id: string; booking_id?: string | null; channel: Channel; direction: Direction; subject?: string | null; body: string; occurred_at?: string; follow_up_required?: boolean }) =>
    post<CommunicationRow>("/api/communications", input),
  sendEmail: (input: { customer_id: string; booking_id?: string | null; to: string; template_id?: string; body?: string; subject?: string; override_reason?: string }) =>
    post<CommunicationRow>("/api/communications/send-email", input),
  publishToPortal: (id: string) => post<CommunicationRow>(`/api/communications/${id}/publish-to-portal`),
  guardrailStatus: (customerId: string, templateId?: string) => {
    const qs = new URLSearchParams({ customer_id: customerId });
    if (templateId) qs.set("template_id", templateId);
    return fetch(`/api/communications/guardrail-status?${qs}`).then((r) => unwrap<GuardrailStatus>(r));
  },

  templates: (filter?: { channel?: string; purpose?: string; project_id?: string }) => {
    const qs = new URLSearchParams();
    if (filter?.channel) qs.set("channel", filter.channel);
    if (filter?.purpose) qs.set("purpose", filter.purpose);
    if (filter?.project_id) qs.set("project_id", filter.project_id);
    const suffix = qs.toString() ? `?${qs}` : "";
    return fetch(`/api/communication-templates${suffix}`).then((r) => unwrap<CommunicationTemplateRow[]>(r));
  },
  createTemplate: (input: { code: string; channel: Channel; purpose: TemplatePurpose; subject?: string | null; body: string; project_id?: string | null }) =>
    post<CommunicationTemplateRow>("/api/communication-templates", input),
  submitTemplateForLegalReview: (id: string) => post<CommunicationTemplateRow>(`/api/communication-templates/${id}/submit-legal-review`),
  approveTemplate: (id: string) => post<CommunicationTemplateRow>(`/api/communication-templates/${id}/approve`),
  previewTemplate: (id: string, bookingId?: string | null) => post<{ subject: string; body: string; unresolved: string[] }>(`/api/communication-templates/${id}/preview`, { booking_id: bookingId ?? null }),

  notes: (entityType: string, entityId: string) =>
    fetch(`/api/internal-notes?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`).then((r) => unwrap<InternalNoteRow[]>(r)),
  createNote: (input: { entity_type: string; entity_id: string; body: string; mentions?: string[] }) =>
    post<InternalNoteRow>("/api/internal-notes", input),
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  CALL: "Call", EMAIL: "Email", WHATSAPP: "WhatsApp", SMS: "SMS", MEETING: "Meeting", NOTICE: "Notice", PORTAL_UPDATE: "Portal update",
};
export const PURPOSE_LABEL: Record<TemplatePurpose, string> = {
  WELCOME: "Welcome", PAYMENT_REMINDER: "Payment reminder", MILESTONE: "Milestone", DOCUMENT_REQUEST: "Document request",
  APPOINTMENT: "Appointment", DELAY_NOTICE: "Delay notice", CUSTOMISATION_QUOTE: "Customisation quote",
  HANDOVER_INVITE: "Handover invite", CHECK_IN: "Check-in", GENERAL: "General",
};
export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = { DRAFT: "Draft", LEGAL_REVIEW: "Legal review", APPROVED: "Approved", RETIRED: "Retired" };
