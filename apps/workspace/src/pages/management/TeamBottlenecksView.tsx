import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Badge } from "@homeflow/ui";
import { cn } from "../../lib/utils";
import { managementApi, type DepartmentRow } from "./api";

/** 27-management-control-tower.md rule 8 — "table, not charts": actions by department, SLA state,
 *  median age, top blockers. */
export function TeamBottlenecksView({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    managementApi.teamBottlenecks(projectId).then(setRows).catch(() => setError(true)).finally(() => setLoading(false));
  }, [projectId]);

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
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading team bottlenecks">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="text-subhead text-fg-muted">No open actions for this project.</CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-footnote">
          <thead>
            <tr className="text-caption uppercase tracking-wide text-fg-subtle">
              <th className="p-2 text-left">Department</th>
              <th className="p-2 text-left">Open</th>
              <th className="p-2 text-left">On track</th>
              <th className="p-2 text-left">Overdue</th>
              <th className="p-2 text-left">Breached</th>
              <th className="p-2 text-left">Median age</th>
              <th className="p-2 text-left">Top blockers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.owner_role} className="border-t border-line">
                <td className="p-2 font-semibold">{r.owner_role}</td>
                <td className="p-2">{r.open_count}</td>
                <td className="p-2 text-ontrack">{r.on_track}</td>
                <td className={cn("p-2", r.overdue > 0 && "text-due")}>{r.overdue}</td>
                <td className={cn("p-2", r.breached > 0 && "text-overdue")}>{r.breached}</td>
                <td className="p-2">{r.median_age_days === null ? "—" : `${r.median_age_days.toFixed(1)}d`}</td>
                <td className="p-2">
                  {r.top_blockers.length === 0 ? (
                    "—"
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.top_blockers.map((b) => (
                        <Badge key={b.reason} tone="neutral">
                          {b.reason} ({b.count})
                        </Badge>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
