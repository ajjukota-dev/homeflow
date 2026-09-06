// Policy Studio API client (25-policy-studio.md). Same req<T>/ApiError pattern as
// auth/adminApi.ts — draft/publish need to distinguish a `forbidden` edit-role rejection
// from a generic failure, same as the permission-matrix screen already does.
import { ApiError } from "../../auth/api";

export interface TabDef {
  key: string; // "<owner_spec>.<slug>"
  label: string;
  owner_spec: number;
  built: boolean;
  edit_roles: string[];
  can_edit: boolean;
}

export interface StudioRow {
  [key: string]: unknown;
}

export interface HistoryRow {
  id: string;
  version: number;
  effective_from: string | null;
  effective_to: string | null;
  changed_by: string;
  changed_at: string;
  change_note: string | null;
  diff: StudioRow;
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

export const studioApi = {
  listTabs: () => req<TabDef[]>("GET", "/api/studio/tabs"),
  listTable: (table: string) => req<StudioRow[]>("GET", `/api/studio/${table}`),
  draftRow: (table: string, rowId: string | null, values: StudioRow, note?: string) =>
    req<{ id: string }>("POST", `/api/studio/${table}`, { row_id: rowId, values, note }),
  publishRow: (table: string, draftId: string, effectiveFrom: string, note?: string) =>
    req<{ ok: boolean }>("POST", `/api/studio/${table}/${draftId}/publish`, { effective_from: effectiveFrom, note }),
  getHistory: (table: string, rowId: string) => req<HistoryRow[]>("GET", `/api/studio/${table}/${rowId}/history`),
  previewChange: (table: string, rowId: string) => req<{ open_sla_clocks: number }>("POST", `/api/studio/${table}/preview`, { row_id: rowId }),
};

// 19-collections-true-risk.md's Payment plans tab — plain CRUD, not the draft/publish envelope
// above (payment_plan/payment_plan_milestone carry no version/effective_from columns).
export interface PaymentPlanMilestone {
  id?: string;
  milestone_key: string;
  milestone_label: string;
  construction_trigger_event: string | null;
  sequence: number;
  pct_of_consideration: number;
}

export interface PaymentPlan {
  id: string;
  project_id: string | null;
  name: string;
  basis: string;
  milestones: PaymentPlanMilestone[];
}

export const paymentPlanApi = {
  list: () => req<PaymentPlan[]>("GET", "/api/payment-plans"),
  create: (input: { project_id: string | null; name: string; basis: string; milestones: PaymentPlanMilestone[] }) =>
    req<PaymentPlan>("POST", "/api/payment-plans", input),
  update: (id: string, input: { project_id: string | null; name: string; basis: string; milestones: PaymentPlanMilestone[] }) =>
    req<PaymentPlan>("PUT", `/api/payment-plans/${id}`, input),
};
