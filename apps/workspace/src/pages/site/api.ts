// 07-unit-progress-control.md's API list. Same req/unwrap pattern as pages/management/api.ts.
import { ApiError } from "../../auth/api";

export type SpecProgressState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "VERIFIED" | "REWORK";
export type Freshness = "FRESH" | "STALE" | "VERIFICATION_REQUIRED";
export type ProgressSource = "SITE_ENTRY" | "QA_VERIFICATION" | "BULK_UPDATE" | "IMPORT" | "SYSTEM";

export interface ProgressCell {
  component_code: string;
  label: string;
  state_code: SpecProgressState;
  pct: number | null;
  actual_date: string | null;
  planned_next_event: string | null;
  planned_next_event_date: string | null;
  source: ProgressSource;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  freshness: Freshness;
}

export interface UnitProgressRow {
  unit_id: string;
  unit_number: string;
  hierarchy_node_id: string;
  components: ProgressCell[];
}

export interface ProgressHistoryEntry {
  type: string;
  occurred_at: string;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
}

export interface BulkPreviewUnit {
  unit_id: string;
  unit_number: string;
  current_state: SpecProgressState;
  no_op: boolean;
  regression: boolean;
  gate_deltas: { category_code: string; from: string; to: string }[];
  held: boolean;
}

export interface BulkPreview {
  id: string;
  component_code: string;
  new_state: SpecProgressState;
  units: BulkPreviewUnit[];
  affected_count: number;
  no_op_count: number;
  regression_count: number;
  requires_reason: boolean;
}

export interface BulkApplyResult {
  id: string;
  applied: string[];
  excluded: { unit_id: string; reason: string }[];
  conflicts: string[];
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

export const progressApi = {
  projectProgress: (projectId: string, nodeId?: string) => {
    const qs = nodeId ? `?node_id=${nodeId}` : "";
    return fetch(`/api/projects/${projectId}/progress${qs}`).then((r) => unwrap<UnitProgressRow[]>(r));
  },
  unitProgress: (unitId: string) => fetch(`/api/units/${unitId}/progress`).then((r) => unwrap<{ unit_id: string; components: ProgressCell[] }>(r)),
  history: (unitId: string) => fetch(`/api/units/${unitId}/progress/history`).then((r) => unwrap<ProgressHistoryEntry[]>(r)),
  updateCell: (unitId: string, component: string, input: { state_code: string; pct?: number; reason?: string }) =>
    fetch(`/api/units/${unitId}/progress/${component}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) =>
      unwrap<{ unit_id: string; components: ProgressCell[] }>(r)
    ),
  previewBulk: (projectId: string, input: { scope: { node_ids?: string[]; unit_ids?: string[] }; component_code: string; new_state: string; reason?: string }) =>
    fetch(`/api/projects/${projectId}/progress/bulk/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) => unwrap<BulkPreview>(r)),
  applyBulk: (previewId: string, exceptions: { unit_id: string; reason: string }[]) =>
    fetch(`/api/progress/bulk/${previewId}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exceptions }) }).then((r) => unwrap<BulkApplyResult>(r)),
};
