import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Button, Badge, Dialog, DialogContent, Tooltip } from "@homeflow/ui";
import { formatINR } from "../../ui/MoneyFigure";
import { cn } from "../../lib/utils";
import { forecastApi, type ForecastLine, type ForecastSnapshot, type CompareResult, type ForecastSourceType } from "./api";

const SOURCE_LABEL: Record<ForecastSourceType, string> = {
  CONTRACTUAL_DUE: "Contractual due",
  OVERDUE_RECOVERY: "Overdue recovery",
  PROMISE_TO_PAY: "Promise to pay",
  LOAN_DISBURSEMENT: "Loan disbursement",
  REGISTRATION_FINAL_DEMAND: "Registration final demand",
  APPROVED_RESCHEDULE: "Approved reschedule",
  MANUAL_FINANCE_OVERRIDE: "Manual override",
  SCENARIO_FUTURE_SALES: "Future sales (scenario)",
};

const STATUS_TONE: Record<ForecastLine["status"], string> = {
  ACTIVE: "text-fg",
  REALISED: "text-ontrack",
  LAPSED: "text-overdue",
  SUPERSEDED: "text-fg-subtle",
};

const WRITE_ROLES = ["ACCOUNTS", "MANAGEMENT", "SUPER_ADMIN"];

function OverrideDialog({ line, onSaved }: { line: ForecastLine; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(line.expected_date.slice(0, 10));
  const [amount, setAmount] = useState(String(line.amount_inr));
  const [probability, setProbability] = useState(String(line.probability));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await forecastApi.overrideLine(line.id, { expected_date: date, amount_inr: Number(amount), probability: Number(probability), reason: reason.trim() });
      setOpen(false);
      setReason("");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Override
      </Button>
      <DialogContent title="Override forecast line" description="Requires role Accounts lead + a reason (rule 1). Supersedes the derived line for this demand.">
        <div className="flex flex-col gap-3">
          <label className="text-footnote font-medium text-fg-muted">
            Expected date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body" />
          </label>
          <label className="text-footnote font-medium text-fg-muted">
            Amount (₹)
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body" />
          </label>
          <label className="text-footnote font-medium text-fg-muted">
            Probability (0–1)
            <input type="number" step="0.05" min="0" max="1" value={probability} onChange={(e) => setProbability(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body" />
          </label>
          <label className="text-footnote font-medium text-fg-muted">
            Reason (required)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
          </label>
          <Button onClick={save} disabled={!reason.trim() || busy}>
            {busy ? "Saving…" : "Save override"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 20-cash-forecast.md Screens: "Project Collections Forecast — lines table (source type chip,
 *  booking, expected date, amount, probability with drivers tooltip, status), filters, override
 *  dialog (authorised), snapshot list + compare picker." Committed/BASE lane only — the Cash Flow
 *  Planner owns scenario comparison. */
export function CollectionsForecast({ projectId, roles }: { projectId: string; roles: string[] }) {
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
  const [lines, setLines] = useState<ForecastLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<ForecastSourceType | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<ForecastLine["status"] | "ALL">("ACTIVE");

  const [snapshots, setSnapshots] = useState<ForecastSnapshot[]>([]);
  const [takingSnapshot, setTakingSnapshot] = useState(false);
  const [comparePeriod, setComparePeriod] = useState(new Date().toISOString().slice(0, 7));
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    forecastApi
      .get(projectId, { scenario: "BASE", lane: "COMMITTED" })
      .then((v) => setLines(v.lines))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(load, [load]);

  const loadSnapshots = useCallback(() => {
    if (!projectId) return;
    forecastApi.snapshots(projectId).then(setSnapshots).catch(() => setError(true));
  }, [projectId]);

  useEffect(loadSnapshots, [loadSnapshots]);

  async function takeSnapshot() {
    setTakingSnapshot(true);
    try {
      await forecastApi.takeSnapshot(projectId);
      loadSnapshots();
    } finally {
      setTakingSnapshot(false);
    }
  }

  async function runCompare() {
    setComparing(true);
    setCompareResult(null);
    try {
      setCompareResult(await forecastApi.compare(projectId, comparePeriod));
    } finally {
      setComparing(false);
    }
  }

  const filtered = lines.filter((l) => (sourceFilter === "ALL" || l.source_type === sourceFilter) && (statusFilter === "ALL" || l.status === statusFilter));

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Collections Forecast</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">Committed forecast lines for this month + the next 3 — one active line per rupee, never double-counted.</p>
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}

      {!error && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
              <option value="ALL">All source types</option>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {/* buildForecastView only ever returns ACTIVE/REALISED lines (LAPSED/SUPERSEDED lines
                are superseded-out of the committed view by design) — the two dead options were
                removed rather than left to silently never match anything. */}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
              <option value="ALL">All statuses</option>
              {(["ACTIVE", "REALISED"] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {loading && (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading forecast lines">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl border border-line bg-surface-2" />
              ))}
            </div>
          )}

          {!loading &&
            (filtered.length === 0 ? (
              <Card>
                <CardBody className="text-subhead text-fg-muted">No forecast lines match these filters.</CardBody>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((l) => (
                  <Card key={l.id}>
                    <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="accent">{SOURCE_LABEL[l.source_type] ?? l.source_type}</Badge>
                          <span className={cn("text-footnote font-semibold", STATUS_TONE[l.status])}>{l.status}</span>
                        </div>
                        <div className="mt-1 text-body font-semibold">
                          {l.booking_number ?? l.booking_id}
                          {l.unit_number ? ` · Villa ${l.unit_number}` : ""}
                        </div>
                        <div className="text-footnote text-fg-muted">Expected {l.expected_date.slice(0, 10)}</div>
                      </div>
                      <div className="sm:text-right">
                        <div className="font-mono text-body font-semibold tabular-nums">{formatINR(l.amount_inr)}</div>
                        <Tooltip content={l.probability_drivers.length ? l.probability_drivers.map((d) => `${d.label}: ${d.value}`).join(" · ") : "No drivers recorded"}>
                          <span className="cursor-help text-footnote text-fg-muted underline decoration-dotted">{Math.round(l.probability * 100)}% probability</span>
                        </Tooltip>
                      </div>
                      {canWrite && l.lane === "COMMITTED" && l.status === "ACTIVE" && (
                        <div className="sm:ml-2">
                          <OverrideDialog line={l} onSaved={load} />
                        </div>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            ))}

          <Card className="mt-8">
            <CardHeader>
              <h2 className="text-title3 font-semibold">Snapshots &amp; comparison</h2>
              <p className="mt-1 text-footnote text-fg-muted">Snapshots are immutable — comparisons read them, never recompute history (rule 3).</p>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              {canWrite && (
                <Button size="sm" variant="secondary" onClick={takeSnapshot} disabled={takingSnapshot} className="self-start">
                  {takingSnapshot ? "Taking snapshot…" : "Take manual snapshot"}
                </Button>
              )}

              {snapshots.length === 0 ? (
                <p className="text-footnote text-fg-muted">No snapshots taken yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-footnote">
                    <thead>
                      <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                        <th className="p-2 text-left">Kind</th>
                        <th className="p-2 text-left">Taken</th>
                        <th className="p-2 text-left">Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className="p-2">{s.kind}</td>
                          <td className="p-2">{s.taken_at.slice(0, 10)}</td>
                          <td className="p-2">
                            {s.period_from} → {s.period_to}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
                <label className="text-footnote font-medium text-fg-muted">
                  Compare period
                  <input type="month" value={comparePeriod} onChange={(e) => setComparePeriod(e.target.value)} className="mt-1 block rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body" />
                </label>
                <Button size="sm" onClick={runCompare} disabled={comparing}>
                  {comparing ? "Comparing…" : "Compare"}
                </Button>
              </div>

              {compareResult && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Actual", value: compareResult.actual },
                    { label: "Forecast at month start", value: compareResult.forecast_at_month_start },
                    { label: "Latest forecast", value: compareResult.latest },
                    { label: "Actual to date", value: compareResult.actual_to_date },
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl border border-line bg-surface-2 p-3">
                      <div className="text-caption text-fg-subtle">{c.label}</div>
                      <div className="mt-1 font-mono text-body font-semibold tabular-nums">{c.value === null ? "No snapshot" : formatINR(c.value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
