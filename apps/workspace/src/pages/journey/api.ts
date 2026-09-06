// Journey timeline / SLA engine client (06-timeline-sla-engine.md). Same req/unwrap pattern as
// components/ActionDrawer/api.ts and pages/studio/api.ts.
import { ApiError } from "../../auth/api";

export type ClockStatus = "ON_TRACK" | "DUE_SOON" | "AT_RISK" | "OVERDUE" | "COMPLETED_ON_TIME" | "COMPLETED_LATE";
export type Stream = "COMMERCIAL" | "LEGAL" | "FINANCE" | "CONSTRUCTION" | "HANDOVER" | "POST_HANDOVER";

export interface JourneyTask {
  task_instance_id: string;
  task_code: string;
  title: string;
  customer_title: string | null;
  customer_visible: boolean;
  execution_type: string;
  action_id: string | null;
  status: string;
  clock_status: ClockStatus | null;
  due_at: string | null;
}

export interface JourneyStage {
  stage_instance_id: string;
  stage_code: string;
  name: string;
  customer_name: string | null;
  stream: Stream;
  customer_visible: boolean;
  owner_department: string;
  owner_user_id: string | null;
  status: string;
  progress_pct: number;
  baseline_start: string;
  baseline_end: string;
  planned_start: string;
  planned_end: string;
  forecast_start: string;
  forecast_end: string;
  variance_days: number;
  slippage_days: number;
  tasks: JourneyTask[];
}

export interface Journey {
  id: string;
  status: string;
  health: string;
  hold_reason: string | null;
  started_at: string;
  stages: JourneyStage[];
}

export interface TaskDetail {
  id: string;
  task_code: string;
  title: string;
  customer_title: string | null;
  status: string;
  action_id: string | null;
  baseline_start: string;
  baseline_end: string;
  planned_start: string;
  planned_end: string;
  forecast_start: string;
  forecast_end: string;
  actual_start: string | null;
  actual_end: string | null;
  clock: {
    due_at: string;
    stopped_at: string | null;
    outcome: "ON_TIME" | "LATE" | null;
    status: ClockStatus;
    total_paused_seconds: number;
    events: { at: string; kind: "START" | "PAUSE" | "RESUME" | "STOP" | "RESET"; reason: string | null }[];
  } | null;
  depends_on: { task_code: string; kind: "FINISH_TO_START" | "START_TO_START"; lag_days: number }[];
  blocks: { task_code: string; kind: "FINISH_TO_START" | "START_TO_START"; lag_days: number }[];
}

export interface PlanRevision {
  id: string;
  journey_id: string;
  revised_at: string;
  revised_by: string | null;
  reason_code: string;
  note: string | null;
  changes: { stage_code: string; old_planned_start: string; old_planned_end: string; new_planned_start: string; new_planned_end: string }[];
}

export interface JourneyControlRow {
  journey_id: string;
  booking_id: string;
  booking_number: string;
  unit_number: string;
  customer_name: string;
  health: string;
  status: string;
  current_stage_per_stream: { stream: Stream; stage_code: string; name: string; status: string }[];
  planned_handover: string;
  forecast_handover: string;
  slippage_days: number;
}

export interface ProjectJourneyControl {
  journeys: JourneyControlRow[];
  top_delay_reasons: { code: string; label: string; count: number }[];
}

export interface DelayReason {
  code: string;
  label: string;
  category: string;
  counts_against_sla: boolean;
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

export const journeyApi = {
  getForBooking: (bookingId: string) => req<Journey>("GET", `/api/bookings/${bookingId}/journey`),
  hold: (journeyId: string, reason: string) => req<{ ok: boolean }>("POST", `/api/journeys/${journeyId}/hold`, { reason }),
  resume: (journeyId: string, reason: string) => req<{ ok: boolean }>("POST", `/api/journeys/${journeyId}/resume`, { reason }),
  close: (journeyId: string, reason: string) => req<{ ok: boolean }>("POST", `/api/journeys/${journeyId}/close`, { reason }),
  getTaskDetail: (taskInstanceId: string) => req<TaskDetail>("GET", `/api/task-instances/${taskInstanceId}`),
  reopenTask: (taskInstanceId: string, reason: string) => req<{ ok: boolean }>("POST", `/api/task-instances/${taskInstanceId}/reopen`, { reason }),
  createPlanRevision: (journeyId: string, input: { changes: { stage_code: string; new_planned_start: string; new_planned_end: string }[]; reason_code: string; note?: string }) =>
    req<PlanRevision>("POST", `/api/journeys/${journeyId}/plan-revision`, input),
  listRevisions: (journeyId: string) => req<PlanRevision[]>("GET", `/api/journeys/${journeyId}/revisions`),
  getProjectControl: (projectId: string) => req<ProjectJourneyControl>("GET", `/api/projects/${projectId}/journey-control`),
  listDelayReasons: () => req<DelayReason[]>("GET", "/api/studio/delay_reason"),
};
