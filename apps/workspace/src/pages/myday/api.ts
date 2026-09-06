// My Day API client (11-my-day-ranking.md). Same req<T>/ApiError pattern as
// auth/api.ts / pages/studio/api.ts. `why_now` is generated server-side (myday/rank.ts::whyNow)
// and returned as a ready sentence — render it verbatim, never re-derive it client-side.
import { ApiError } from "../../auth/api";

export interface MyDayAction {
  id: string;
  code: string;
  title: string;
  status: string;
  due_at: string | null;
  score: number;
  why_now: string;
}

export interface MyDayView {
  due_today: MyDayAction[];
  at_risk: MyDayAction[];
  waiting_on_me: MyDayAction[];
  needs_my_approval: MyDayAction[];
  customers_waiting: MyDayAction[];
  done_today: number;
}

export interface TeamDayMember {
  counts: Record<string, number>;
  top3: MyDayAction[];
}

export type TeamDayView = Record<string, TeamDayMember>;

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

export const mydayApi = {
  getMyDay: (projectId?: string): Promise<MyDayView> =>
    fetch(`/api/me/day${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`).then((r) => unwrap(r)),
  getTeamDay: (projectId: string): Promise<TeamDayView> =>
    fetch(`/api/teams/${encodeURIComponent(projectId)}/day`).then((r) => unwrap(r)),
};
