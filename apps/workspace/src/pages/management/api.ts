// 27-management-control-tower.md's API list (the 6 endpoints not already covered by
// api-lifecycle.ts's controlTower/actIntervention/dismissIntervention). Same req/unwrap pattern
// as pages/finance/api.ts.
import { ApiError } from "../../auth/api";

export interface KpiView {
  code: string;
  domain: string;
  name: string;
  formula_ref: string;
  unit: "PERCENT" | "DAYS" | "INR" | "COUNT" | "SCORE";
  direction: "HIGHER_BETTER" | "LOWER_BETTER";
  target: number | null;
  value: number | null;
  numerator: number;
  denominator: number;
  period: string;
  trend: number | null;
}

export interface KpiDrill extends Omit<KpiView, "value" | "numerator" | "denominator" | "period" | "trend"> {
  current: { value: number | null; numerator: number; denominator: number };
  history: { period: string; value: number }[];
}

export interface ExceptionRow {
  kind: string;
  id: string;
  unit_id: string | null;
  booking_id: string | null;
  owner: string | null;
  headline: string;
  occurred_at: string;
}

export interface ProfitabilityRow {
  kind: string;
  unit_id: string | null;
  booking_id: string | null;
  amount_inr: number;
  reason: string | null;
  occurred_at: string;
}

export interface Profitability {
  totals_by_kind: Record<string, number>;
  rows: ProfitabilityRow[];
  per_unit: { unit_id: string; unit_number: string; contribution: number; leakage: number; quality_cost: number }[];
}

export interface PortfolioRow {
  project_id: string;
  project_name: string;
  readiness_pct: number | null;
  cash_outstanding_inr: number;
  risk_inr: number;
  experience_score: number | null;
}

export interface DepartmentRow {
  owner_role: string;
  open_count: number;
  on_track: number;
  overdue: number;
  breached: number;
  median_age_days: number | null;
  top_blockers: { reason: string; count: number }[];
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

export const managementApi = {
  kpis: (projectId: string, domain?: string) => {
    const qs = new URLSearchParams({ project_id: projectId });
    if (domain) qs.set("domain", domain);
    return fetch(`/api/kpis?${qs}`).then((r) => unwrap<KpiView[]>(r));
  },
  kpiDrill: (code: string, projectId: string) =>
    fetch(`/api/kpis/${code}/drill?project_id=${projectId}`).then((r) => unwrap<KpiDrill>(r)),
  exceptions: (projectId: string, kind?: string) => {
    const qs = new URLSearchParams({ project_id: projectId });
    if (kind) qs.set("kind", kind);
    return fetch(`/api/exceptions?${qs}`).then((r) => unwrap<ExceptionRow[]>(r));
  },
  profitability: (projectId: string) => fetch(`/api/profitability?project_id=${projectId}`).then((r) => unwrap<Profitability>(r)),
  portfolio: () => fetch(`/api/portfolio`).then((r) => unwrap<PortfolioRow[]>(r)),
  teamBottlenecks: (projectId: string) => fetch(`/api/teams/bottlenecks?project_id=${projectId}`).then((r) => unwrap<DepartmentRow[]>(r)),
};
