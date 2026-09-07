// 31-intelligence.md rule 5/7 — Suggestions inbox. Every LLM output is a suggestion until a
// human accepts (rule 7): this client only ever lists/creates/accepts/rejects `llm_task` rows,
// it never applies anything to a business table itself (each kind's own accept step does that
// server-side). Same req/unwrap pattern as pages/three-sixty/api.ts.
import { ApiError } from "../../auth/api";

export type LlmTaskKind =
  | "COMMITMENT_DETECTION"
  | "COMMUNICATION_SUMMARY"
  | "SENTIMENT"
  | "DOCUMENT_FIELD_EXTRACTION"
  | "DOCUMENT_INCONSISTENCY"
  | "SNAG_ROOT_CAUSE_SUGGESTION";

export interface LlmTaskRow {
  id: string;
  kind: LlmTaskKind;
  input_ref: string;
  output: Record<string, unknown>;
  confidence: number | null;
  model: string;
  tokens: number;
  cost_inr: number;
  reviewed_by: string | null;
  accepted: boolean | null;
  at: string;
}

export interface CommitmentEdits {
  booking_id: string;
  category: "MODIFICATION" | "COMMERCIAL" | "TIMELINE" | "COMPLIMENTARY_ITEM" | "SPECIFICATION_UPGRADE" | "SERVICE" | "OTHER";
  description: string;
  source: "COMMUNICATION";
  beneficiary: "CUSTOMER" | "INTERNAL";
  customer_facing: boolean;
  due_date?: string | null;
  approval_required: boolean;
}

export interface CommunicationRef { id: string; booking_id: string | null; customer_id: string }

export interface LlmUsage { month_to_date: { total_calls: string; total_tokens: string; total_cost_inr: number } }

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

export const suggestionsApi = {
  list: (kind?: LlmTaskKind, accepted?: boolean) => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (accepted !== undefined) params.set("accepted", String(accepted));
    const qs = params.toString();
    return req<LlmTaskRow[]>(`/api/llm/tasks${qs ? `?${qs}` : ""}`, "GET");
  },
  create: (kind: LlmTaskKind, input_ref: string) => req<LlmTaskRow>(`/api/llm/tasks`, "POST", { kind, input_ref }),
  acceptCommitment: (id: string, commitment: CommitmentEdits) => req<{ commitment_id: string }>(`/api/llm/tasks/${id}/accept`, "POST", { commitment }),
  acceptWithOverride: (id: string, override?: string) => req<LlmTaskRow>(`/api/llm/tasks/${id}/accept`, "POST", override ? { override } : {}),
  reject: (id: string) => req<LlmTaskRow>(`/api/llm/tasks/${id}/reject`, "POST"),
  getCommunication: (id: string) => req<CommunicationRef>(`/api/communications/${id}`, "GET"),
  usage: () => req<LlmUsage>(`/api/llm/usage`, "GET"),
};
