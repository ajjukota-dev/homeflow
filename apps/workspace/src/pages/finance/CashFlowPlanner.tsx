import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, Button, Tabs, TabsList, TabsTrigger, Badge } from "@homeflow/ui";
import { formatINR } from "../../ui/MoneyFigure";
import { cn } from "../../lib/utils";
import { forecastApi, type Confidence, type ForecastView, type Scenario } from "./api";

// Mirrors authz/requireRole.ts's FORECAST_WRITE_ROLES exactly — same pattern as
// CollectionsForecast.tsx's WRITE_ROLES (server still enforces; this is UX-only).
const WRITE_ROLES = ["ACCOUNTS", "MANAGEMENT", "SUPER_ADMIN"];

const ASSUMPTION_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "COLLECTION_EFFICIENCY_PCT", label: "Collection efficiency %", hint: "Share of expected collections that actually land" },
  { key: "LOAN_DISBURSEMENT_LAG_DAYS", label: "Loan disbursement lag (days)", hint: "Extra delay applied to loan inflow lines" },
  { key: "FUTURE_SALES_PER_MONTH", label: "Future sales / month", hint: "New bookings assumed per month" },
  { key: "FUTURE_SALE_TICKET_INR", label: "Future sale ticket size (₹)", hint: "Average booking value for those future sales" },
  { key: "CONSTRUCTION_SLIP_DAYS", label: "Construction slip (days)", hint: "Delay applied to construction-linked demands" },
  { key: "PTP_HONOUR_PCT", label: "Promise-to-pay honour %", hint: "Share of promised-to-pay lines assumed to land" },
];

const CONFIDENCE_TONE: Record<Confidence, string> = {
  HIGH: "text-ontrack",
  MEDIUM: "text-due",
  LOW: "text-overdue",
};

// Fixed to day 1 before adding the offset (matches forecast/core.ts's own defaultRange) —
// operating on today's day-of-month overflowed on the 29th-31st (e.g. Aug 31 + 3 -> Dec 1,
// a 4-month skip instead of 3). IST is UTC+5:30, so a UTC "today" can still read as yesterday
// or tomorrow near midnight IST; acceptable here since this only picks a coarse month window.
function monthsFromToday(offset: number): string {
  const d = new Date();
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** 20-cash-forecast.md Screens: "Project Cash Flow Planner — month columns × waterfall rows;
 *  scenario tabs (BASE locked, others editable assumptions panel); lane toggle with explicit
 *  labels; target line; confidence band." Lane is only meaningful for a non-baseline scenario —
 *  BASE has no SCENARIO lane at all (backend throws), so the toggle only appears once one exists. */
export function CashFlowPlanner({ projectId, roles }: { projectId: string; roles: string[] }) {
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioCode, setScenarioCode] = useState("BASE");
  const [lane, setLane] = useState<"COMMITTED" | "SCENARIO">("COMMITTED");
  const [from] = useState(monthsFromToday(0));
  const [to] = useState(monthsFromToday(3));
  const [view, setView] = useState<ForecastView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [assumptions, setAssumptions] = useState<Record<string, string>>({});
  const [savingAssumptions, setSavingAssumptions] = useState(false);
  const [newScenarioCode, setNewScenarioCode] = useState("");
  const [creatingScenario, setCreatingScenario] = useState(false);

  const activeScenario = scenarios.find((s) => s.code === scenarioCode);

  const loadScenarios = useCallback(() => {
    if (!projectId) return;
    forecastApi.scenarios(projectId).then(setScenarios).catch(() => setError(true));
  }, [projectId]);

  useEffect(loadScenarios, [loadScenarios]);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    forecastApi
      .get(projectId, { scenario: scenarioCode, from, to, lane: scenarioCode === "BASE" ? "COMMITTED" : lane })
      .then(setView)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId, scenarioCode, lane, from, to]);

  useEffect(load, [load]);

  useEffect(() => {
    if (scenarioCode === "BASE") setLane("COMMITTED");
    else setLane("SCENARIO");
  }, [scenarioCode]);

  // Prefill the panel from what's actually saved — otherwise switching tabs away and back
  // shows blank inputs while the waterfall below is still using the saved values (advisor
  // review, spec 20: a write-only round trip is indistinguishable from a broken one).
  useEffect(() => {
    if (!activeScenario) return;
    const prefilled: Record<string, string> = {};
    for (const f of ASSUMPTION_FIELDS) {
      const v = activeScenario.assumptions[f.key];
      if (v !== undefined) prefilled[f.key] = String(v);
    }
    setAssumptions(prefilled);
  }, [activeScenario]);

  async function createScenario() {
    if (!newScenarioCode.trim()) return;
    setCreatingScenario(true);
    try {
      const created = await forecastApi.createScenario(projectId, newScenarioCode.trim().toUpperCase());
      setNewScenarioCode("");
      loadScenarios();
      setScenarioCode(created.code);
    } finally {
      setCreatingScenario(false);
    }
  }

  async function saveAssumptions() {
    if (!activeScenario) return;
    setSavingAssumptions(true);
    try {
      const rows = ASSUMPTION_FIELDS.filter((f) => assumptions[f.key]?.trim()).map((f) => ({ key: f.key, value: Number(assumptions[f.key]) }));
      setScenarios(await forecastApi.putAssumptions(activeScenario.id, rows));
      load();
    } finally {
      setSavingAssumptions(false);
    }
  }

  const rows = useMemo(
    () =>
      view
        ? [
            { label: "Opening outstanding", get: (p: (typeof view.periods)[number]) => p.opening_outstanding },
            { label: "+ Demands raised", get: (p: (typeof view.periods)[number]) => p.demands_raised },
            { label: "+ Expected (weighted)", get: (p: (typeof view.periods)[number]) => p.expected_weighted },
            { label: "+ Overdue recovery", get: (p: (typeof view.periods)[number]) => p.overdue_recovery_weighted },
            { label: "+ Loan inflow", get: (p: (typeof view.periods)[number]) => p.loan_inflow_weighted },
            { label: "= Closing outstanding", get: (p: (typeof view.periods)[number]) => p.closing_outstanding, strong: true },
          ]
        : [],
    [view]
  );

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Cash Flow Planner</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Opening → demands → expected collections → closing, by month. Scenarios never overwrite the committed baseline.
        </p>
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}

      {!error && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Tabs value={scenarioCode} onValueChange={setScenarioCode}>
              <TabsList>
                {scenarios.map((s) => (
                  <TabsTrigger key={s.id} value={s.code}>
                    {s.code}
                    {s.is_baseline && " (locked)"}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {canWrite && (
              <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                <input
                  value={newScenarioCode}
                  onChange={(e) => setNewScenarioCode(e.target.value)}
                  placeholder="CONSERVATIVE / STRETCH / custom"
                  className="w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote outline-none focus:border-accent sm:w-52"
                />
                <Button size="sm" variant="secondary" onClick={createScenario} disabled={!newScenarioCode.trim() || creatingScenario}>
                  + New scenario
                </Button>
              </div>
            )}
          </div>

          {activeScenario && !activeScenario.is_baseline && (
            <div className="mb-4 flex items-center gap-3">
              <span className="text-footnote font-medium text-fg-muted">Lane:</span>
              <div className="flex overflow-hidden rounded-full border border-line">
                {(["SCENARIO", "COMMITTED"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLane(l)}
                    className={cn(
                      "px-3 py-1.5 text-footnote font-semibold",
                      lane === l ? "bg-fg text-surface" : "bg-surface text-fg-muted"
                    )}
                  >
                    {l === "SCENARIO" ? "Scenario (assumptions applied)" : "Committed (baseline lines)"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeScenario && !activeScenario.is_baseline && lane === "SCENARIO" && (
            <Card className="mb-6">
              <CardHeader>
                <h2 className="text-title3 font-semibold">{activeScenario.code} assumptions</h2>
                <p className="mt-1 text-footnote text-fg-muted">Applied to a copy of the committed lines — the BASE baseline is never touched (rule 5).</p>
              </CardHeader>
              <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ASSUMPTION_FIELDS.map((f) => (
                  <label key={f.key} className="text-footnote font-medium text-fg-muted">
                    {f.label}
                    <input
                      type="number"
                      value={assumptions[f.key] ?? ""}
                      onChange={(e) => setAssumptions((a) => ({ ...a, [f.key]: e.target.value }))}
                      placeholder={f.hint}
                      disabled={!canWrite}
                      className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body outline-none focus:border-accent disabled:opacity-60"
                    />
                  </label>
                ))}
                {canWrite && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Button size="sm" onClick={saveAssumptions} disabled={savingAssumptions}>
                      {savingAssumptions ? "Saving…" : "Save assumptions"}
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {loading && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy="true" aria-label="Loading forecast">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-xl border border-line bg-surface-2" />
              ))}
            </div>
          )}

          {!loading && view && view.periods.length === 0 && (
            <Card>
              <CardBody className="text-subhead text-fg-muted">No forecast periods in range.</CardBody>
            </Card>
          )}

          {!loading && view && view.periods.length > 0 && (
            <Card>
              <CardBody className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-footnote">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-surface p-2 text-left text-caption font-semibold uppercase tracking-wide text-fg-subtle">
                        {view.lane} · {view.scenario.code}
                      </th>
                      {view.periods.map((p) => (
                        <th key={p.period} className="p-2 text-right text-body font-semibold">
                          {monthLabel(p.period)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label} className="border-t border-line">
                        <td className={cn("sticky left-0 bg-surface p-2 text-fg-muted", row.strong && "font-semibold text-fg")}>{row.label}</td>
                        {view.periods.map((p) => (
                          <td key={p.period} className={cn("p-2 text-right font-mono tabular-nums", row.strong && "font-semibold")}>
                            {formatINR(row.get(p))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t border-line">
                      <td className="sticky left-0 bg-surface p-2 text-fg-muted">Target</td>
                      {view.periods.map((p) => (
                        <td key={p.period} className="p-2 text-right font-mono tabular-nums text-fg-subtle">
                          {p.target_inr === null ? "No target set" : formatINR(p.target_inr)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-line">
                      <td className="sticky left-0 bg-surface p-2 text-fg-muted">Shortfall vs target</td>
                      {view.periods.map((p) => (
                        <td
                          key={p.period}
                          className={cn("p-2 text-right font-mono tabular-nums", p.shortfall !== null && p.shortfall < 0 && "text-overdue")}
                        >
                          {p.shortfall === null ? "—" : formatINR(p.shortfall)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-line">
                      <td className="sticky left-0 bg-surface p-2 text-fg-muted">Confidence</td>
                      {view.periods.map((p) => (
                        <td key={p.period} className="p-2 text-right">
                          <Badge className={CONFIDENCE_TONE[p.confidence]}>{p.confidence}</Badge>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
