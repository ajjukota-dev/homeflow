// 20-cash-forecast.md's API list, verbatim. Same req/unwrap pattern as pages/sales-handover/api.ts.
import { ApiError } from "../../auth/api";

export type ForecastSourceType =
  | "CONTRACTUAL_DUE"
  | "OVERDUE_RECOVERY"
  | "PROMISE_TO_PAY"
  | "LOAN_DISBURSEMENT"
  | "REGISTRATION_FINAL_DEMAND"
  | "APPROVED_RESCHEDULE"
  | "MANUAL_FINANCE_OVERRIDE"
  | "SCENARIO_FUTURE_SALES";

export type Lane = "COMMITTED" | "SCENARIO";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export interface ForecastLine {
  id: string;
  project_id: string;
  booking_id: string;
  booking_number: string | null;
  unit_number: string | null;
  demand_id: string | null;
  loan_case_id: string | null;
  source_type: ForecastSourceType;
  lane: Lane;
  scenario_id: string | null;
  expected_date: string;
  amount_inr: number;
  probability: number;
  probability_drivers: { label: string; value: string }[];
  period: string;
  status: "ACTIVE" | "REALISED" | "LAPSED" | "SUPERSEDED";
}

export interface WaterfallPeriod {
  period: string;
  opening_outstanding: number;
  demands_raised: number;
  expected_weighted: number;
  overdue_recovery_weighted: number;
  loan_inflow_weighted: number;
  target_inr: number | null;
  shortfall: number | null;
  closing_outstanding: number;
  confidence: Confidence;
}

export interface Scenario {
  id: string;
  code: string;
  is_baseline: boolean;
  created_at?: string;
  assumptions: Record<string, number>;
}

export interface ForecastView {
  lines: ForecastLine[];
  periods: WaterfallPeriod[];
  scenario: Scenario;
  lane: Lane;
}

export interface ForecastSnapshot {
  id: string;
  kind: "MONTH_START" | "WEEKLY" | "MANUAL";
  taken_at: string;
  period_from: string;
  period_to: string;
  taken_by: string | null;
}

export interface CompareResult {
  period: string;
  actual: number;
  forecast_at_month_start: number | null;
  latest: number;
  actual_to_date: number;
}

export interface PortfolioCompareRow extends CompareResult {
  project_id: string;
  project_name: string;
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

export const forecastApi = {
  get: (projectId: string, query: { scenario?: string; from?: string; to?: string; lane?: Lane }) => {
    const params = new URLSearchParams();
    if (query.scenario) params.set("scenario", query.scenario);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.lane) params.set("lane", query.lane);
    const qs = params.toString();
    return req<ForecastView>("GET", `/api/projects/${projectId}/forecast${qs ? `?${qs}` : ""}`);
  },
  scenarios: (projectId: string) => req<Scenario[]>("GET", `/api/projects/${projectId}/scenarios`),
  createScenario: (projectId: string, code: string) => req<Scenario>("POST", `/api/projects/${projectId}/scenarios`, { code }),
  putAssumptions: (scenarioId: string, assumptions: { key: string; value: number; note?: string }[]) =>
    req<Scenario[]>("PUT", `/api/scenarios/${scenarioId}/assumptions`, { assumptions }),
  overrideLine: (lineId: string, input: { expected_date: string; amount_inr: number; probability: number; reason: string }) =>
    req<ForecastLine>("POST", `/api/forecast-lines/${lineId}/override`, input),
  takeSnapshot: (projectId: string) => req<{ id: string }>("POST", `/api/projects/${projectId}/forecast/snapshots`),
  snapshots: (projectId: string) => req<ForecastSnapshot[]>("GET", `/api/projects/${projectId}/forecast/snapshots`),
  compare: (projectId: string, period: string) => req<CompareResult>("GET", `/api/projects/${projectId}/forecast/compare?period=${period}`),
  portfolioCompare: (period: string) => req<PortfolioCompareRow[]>("GET", `/api/portfolio/forecast/compare?period=${period}`),
};
