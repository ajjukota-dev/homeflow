// 08-changeability-engine.md's API list. Same req/unwrap pattern as pages/site/api.ts.
import { ApiError } from "../../auth/api";

export type GateState = "OPEN" | "CLOSING" | "CONDITIONAL" | "EXCEPTION_ONLY" | "HARD_CLOSED";
export type Freshness = "FRESH" | "VERIFICATION_REQUIRED";

export interface ExceptionRow {
  id: string;
  unit_id: string;
  category_code: string;
  granted_by: string;
  authority_role: string;
  reason: string;
  evidence_file_keys: string[];
  valid_until: string;
  change_request_id: string | null;
  status: "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";
  created_at: string;
  closed_at: string | null;
}

export interface GateView {
  category_code: string;
  state: GateState;
  reason_code: string | null;
  reason_text: string;
  rule_id: number | null;
  expected_close_at: string | null;
  closing_event: string | null;
  freshness_status: Freshness;
  customer_label: string;
  customer_visible: boolean;
  hard_or_soft: "HARD" | "SOFT" | null;
  exception_open: boolean;
  exception: ExceptionRow | null;
  last_evaluated_at: string;
}

export interface FlexibilityScore {
  value: number;
  trend: number | null;
  drivers: { code: string; label: string; contribution: number; fact: string }[];
  confidence: "LOW" | "HIGH";
  confidence_reason: string;
  actions: { action_type: string; title: string; target: string }[];
}

export interface ChangeabilityMatrix {
  unit_id: string;
  unit_number: string;
  project_id: string;
  as_of: string;
  gates: GateView[];
  flexibility: FlexibilityScore;
}

export interface ProjectChangeabilityRow {
  unit_id: string;
  unit_number: string;
  hierarchy_node_id: string;
  flexibility: number;
  gates: { category_code: string; state: GateState; expected_close_at: string | null; freshness_status: Freshness; exception_open: boolean }[];
}

export interface RuleRow {
  id: number;
  code: string | null;
  category_code: string;
  project_id: string | null;
  trigger_component_code: string;
  min_state: string | null;
  trigger_event: string | null;
  condition_expr: string | null;
  resulting_state: GateState;
  hard_or_soft: "HARD" | "SOFT";
  closing_lead_days: number;
  exception_authority_role: string;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  publish_reason: string | null;
  published_by: string | null;
  published_at: string | null;
}

export interface RuleInput {
  category_code: string;
  trigger_component_code: string;
  min_state?: string | null;
  trigger_event?: string | null;
  resulting_state: GateState;
  hard_or_soft?: "HARD" | "SOFT";
  closing_lead_days?: number;
  exception_authority_role?: string;
  priority?: number;
  condition_expr?: string | null;
  code?: string | null;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

export const changeabilityApi = {
  unit: (unitId: string) => fetch(`/api/units/${unitId}/changeability`).then((r) => unwrap<ChangeabilityMatrix>(r)),
  project: (projectId: string, filters: { node_id?: string; category?: string; state?: string } = {}) => {
    const qs = new URLSearchParams();
    if (filters.node_id) qs.set("node_id", filters.node_id);
    if (filters.category) qs.set("category", filters.category);
    if (filters.state) qs.set("state", filters.state);
    const suffix = qs.toString() ? `?${qs}` : "";
    return fetch(`/api/projects/${projectId}/changeability${suffix}`).then((r) => unwrap<ProjectChangeabilityRow[]>(r));
  },
  evaluate: (unitId: string, overrides: Record<string, string>) =>
    fetch(`/api/changeability/evaluate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unit_id: unitId, overrides }) }).then((r) => unwrap<ChangeabilityMatrix>(r)),
  listRules: (projectId: string | null = null, status?: string) => {
    const qs = new URLSearchParams({ project_id: projectId ?? "standard" });
    if (status) qs.set("status", status);
    return fetch(`/api/change-gate-rules?${qs}`).then((r) => unwrap<RuleRow[]>(r));
  },
  // The PUT/POST routes' own `scope()` helper (routes-changeability.ts) has no "standard" sentinel
  // like the GET route does — it passes req.query.project_id through verbatim, defaulting to null
  // only when the param is absent entirely. So standard scope means omitting the query param, not
  // sending the literal string "standard" (which would have been stored as a real project id).
  putRules: (projectId: string | null, rules: RuleInput[]) =>
    fetch(`/api/change-gate-rules${projectId ? `?project_id=${projectId}` : ""}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) }).then((r) => unwrap<RuleRow[]>(r)),
  publishRules: (projectId: string | null, reason: string) =>
    fetch(`/api/change-gate-rules/publish${projectId ? `?project_id=${projectId}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }).then((r) =>
      unwrap<{ version: number; rules: RuleRow[]; reevaluated: number; transitions: number }>(r)
    ),
  grantException: (unitId: string, input: { category_code: string; reason: string; evidence_file_keys: string[]; valid_until: string }) =>
    fetch(`/api/units/${unitId}/gate-exceptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) => unwrap<ExceptionRow>(r)),
  revokeException: (id: string, reason?: string) =>
    fetch(`/api/gate-exceptions/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }).then((r) => unwrap<ExceptionRow>(r)),
};
