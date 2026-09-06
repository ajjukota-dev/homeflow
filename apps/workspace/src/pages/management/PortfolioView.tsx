import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Button } from "@homeflow/ui";
import { formatINR } from "../../ui/MoneyFigure";
import { cn } from "../../lib/utils";
import { managementApi, type PortfolioRow } from "./api";

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n)}%`;
}

/** 27-management-control-tower.md Screens: "Portfolio strip (projects with 4 numbers)" / Portfolio
 *  view tab — readiness, cash, risk, experience, one row per project, drill to project. */
export function PortfolioView({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    managementApi.portfolio().then(setRows).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (error) {
    return (
      <Card>
        <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
      </Card>
    );
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading portfolio">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="text-subhead text-fg-muted">No projects yet.</CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-footnote">
          <thead>
            <tr className="text-caption uppercase tracking-wide text-fg-subtle">
              <th className="p-2 text-left">Project</th>
              <th className="p-2 text-left">Readiness</th>
              <th className="p-2 text-left">Cash outstanding</th>
              <th className="p-2 text-left">True-risk</th>
              <th className="p-2 text-left">Experience</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.project_id} className="border-t border-line">
                <td className="p-2 font-semibold">{r.project_name}</td>
                <td className="p-2">{pct(r.readiness_pct)}</td>
                <td className="p-2 font-mono tabular-nums">{formatINR(r.cash_outstanding_inr)}</td>
                <td className={cn("p-2 font-mono tabular-nums", r.risk_inr > 0 && "text-overdue")}>{formatINR(r.risk_inr)}</td>
                <td className="p-2">{r.experience_score === null ? "—" : r.experience_score.toFixed(1)}</td>
                <td className="p-2">
                  <Button size="sm" variant="secondary" onClick={() => onOpenProject(r.project_id)}>
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
