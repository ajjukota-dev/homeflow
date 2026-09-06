import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Button } from "@homeflow/ui";
import { formatINR } from "../../ui/MoneyFigure";
import { cn } from "../../lib/utils";
import { forecastApi, type PortfolioCompareRow } from "./api";

type SortKey = "project_name" | "actual" | "forecast_at_month_start" | "latest" | "variance";

function variance(row: PortfolioCompareRow): number | null {
  return row.forecast_at_month_start === null ? null : row.latest - row.forecast_at_month_start;
}

/** 20-cash-forecast.md Screens: "Portfolio Project Comparison — projects × periods (actual,
 *  month-start forecast, latest, variance), sortable, drill to project." */
export function PortfolioCompare({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<PortfolioCompareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "project_name", dir: 1 });

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    forecastApi
      .portfolioCompare(period)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(load, [load]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  const sorted = [...rows].sort((a, b) => {
    const va = sort.key === "variance" ? variance(a) : sort.key === "project_name" ? a.project_name : a[sort.key];
    const vb = sort.key === "variance" ? variance(b) : sort.key === "project_name" ? b.project_name : b[sort.key];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * sort.dir;
    return ((va as number) - (vb as number)) * sort.dir;
  });

  const columns: { key: SortKey; label: string }[] = [
    { key: "project_name", label: "Project" },
    { key: "actual", label: "Actual (this period)" },
    { key: "forecast_at_month_start", label: "Forecast at month start" },
    { key: "latest", label: "Latest forecast" },
    { key: "variance", label: "Variance" },
  ];

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Portfolio Comparison</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">Actual vs month-start forecast vs latest, across every project — sortable, never overwriting a prior forecast.</p>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-footnote font-medium text-fg-muted">
          Period
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 block rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body" />
        </label>
      </div>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}

      {!error && loading && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading portfolio comparison">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <Card>
          <CardBody className="text-subhead text-fg-muted">No projects to compare.</CardBody>
        </Card>
      )}

      {!error && !loading && rows.length > 0 && (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-footnote">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="p-2 text-left">
                      <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 font-semibold text-fg-muted hover:text-fg">
                        {c.label}
                        {sort.key === c.key && (sort.dir === 1 ? "▲" : "▼")}
                      </button>
                    </th>
                  ))}
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const v = variance(r);
                  return (
                    <tr key={r.project_id} className="border-t border-line">
                      <td className="p-2 font-semibold">{r.project_name}</td>
                      <td className="p-2 font-mono tabular-nums">{formatINR(r.actual)}</td>
                      <td className="p-2 font-mono tabular-nums">{r.forecast_at_month_start === null ? "No snapshot" : formatINR(r.forecast_at_month_start)}</td>
                      <td className="p-2 font-mono tabular-nums">{formatINR(r.latest)}</td>
                      <td className={cn("p-2 font-mono tabular-nums", v !== null && v < 0 && "text-overdue", v !== null && v > 0 && "text-ontrack")}>{v === null ? "—" : formatINR(v)}</td>
                      <td className="p-2">
                        <Button size="sm" variant="secondary" onClick={() => onOpenProject(r.project_id)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
