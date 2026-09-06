// Universal Action drawer client (10-universal-action.md). Same req/unwrap pattern as
// pages/myday/api.ts. ActionDetail mirrors services/api/src/actions/core.ts's own interface —
// same accepted-duplication class as api.ts's GateState/ProgressState mirrors.
import { ApiError } from "../../auth/api";

export type ActionStatus =
  | "New" | "In Progress" | "Waiting Internal" | "Waiting Customer"
  | "Blocked" | "Ready for Approval" | "Closed" | "Cancelled";
export type ActionFamily = "TASK" | "APPROVAL" | "FOLLOW_UP" | "DOCUMENT_REQUEST" | "EXCEPTION" | "ESCALATION" | "VERIFICATION";
export type SlaState = "ON_TRACK" | "DUE_SOON" | "AT_RISK" | "OVERDUE" | "COMPLETED_ON_TIME" | "COMPLETED_LATE";

export interface ActionChecklistItem {
  id: string; label: string; required: boolean; checked_at: string | null; checked_by: string | null;
}
export interface ActionEvidence {
  id: string; file_key: string; kind: string | null; uploaded_by: string;
  verification_status: "UPLOADED" | "VERIFIED" | "REJECTED"; verified_by: string | null; note: string | null; created_at: string;
}
export interface ActionTransition {
  id: string; from_status: string; to_status: string; at: string; actor: string | null; reason: string | null;
}

export interface ActionDetail {
  id: string; code: string; type: string; family: ActionFamily; title: string; description: string | null;
  project_id: string | null; source_module: string; source_entity_type: string; source_entity_id: string;
  booking_id: string | null; unit_id: string | null; customer_id: string | null;
  owner_user_id: string | null; owner_role: string; backup_owner_user_id: string | null;
  due_at: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; status: ActionStatus; sla_state: SlaState | null;
  blocking_reason: string | null; depends_on_action_id: string | null;
  customer_visible: boolean; customer_title: string | null;
  evidence_requirement: "NONE" | "ATTACHMENT" | "VERIFIED_ATTACHMENT" | "CHECKLIST" | "APPROVAL" | "EXTERNAL_REF";
  approver_role: string | null; verifier_role: string | null; external_reference: string | null;
  escalation_tier: string; origin: "AUTO" | "MANUAL";
  created_by: string | null; closed_at: string | null; closed_by: string | null; close_note: string | null;
  // Set when a journey task backs this action — the server refuses Close/Approve/Cancel from
  // this drawer for such actions (no reverse-sync subscriber exists yet), so TransitionActions
  // hides those buttons rather than let the user hit a 409 after filling in a reason.
  task_instance_id: string | null;
  checklist: ActionChecklistItem[]; evidence: ActionEvidence[]; transitions: ActionTransition[];
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function post(path: string, body?: unknown): Promise<void> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => unwrap(r));
}

export const actionApi = {
  get: (id: string): Promise<ActionDetail> => fetch(`/api/actions/${id}`).then((r) => unwrap(r)),
  claim: (id: string) => post(`/api/actions/${id}/claim`),
  start: (id: string) => post(`/api/actions/${id}/start`),
  wait: (id: string, target: "Waiting Internal" | "Waiting Customer", reason: string) => post(`/api/actions/${id}/wait`, { target, reason }),
  block: (id: string, reason: string) => post(`/api/actions/${id}/block`, { reason }),
  unblock: (id: string) => post(`/api/actions/${id}/unblock`),
  submitForApproval: (id: string) => post(`/api/actions/${id}/submit-approval`),
  approve: (id: string, note?: string) => post(`/api/actions/${id}/approve`, { note }),
  reject: (id: string, reason: string) => post(`/api/actions/${id}/reject`, { reason }),
  close: (id: string, note?: string) => post(`/api/actions/${id}/close`, { note }),
  cancel: (id: string, reason: string) => post(`/api/actions/${id}/cancel`, { reason }),
  setChecklistItem: (id: string, itemId: string, checked: boolean): Promise<void> =>
    fetch(`/api/actions/${id}/checklist/${itemId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checked }),
    }).then((r) => unwrap(r)),
  verifyEvidence: (id: string, evidenceId: string, decision: "verify" | "reject", note?: string) =>
    post(`/api/actions/${id}/evidence/${evidenceId}/${decision}`, { note }),
};
