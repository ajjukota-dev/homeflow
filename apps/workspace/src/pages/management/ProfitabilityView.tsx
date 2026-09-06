import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader } from "@homeflow/ui";
import { formatINR } from "../../ui/MoneyFigure";
import { cn, formatIstDateTime } from "../../lib/utils";
import { managementApi, type Profitability } from "./api";

const KIND_LABEL: Record<string, string> = {
  COMMERCIAL_LEAKAGE: "Commercial leakage",
  SERVICE_LEAKAGE: "Service leakage",
  QUALITY_COST: "Quality cost",
  DELAY_COST: "Delay cost",
  COST_TO_SERVE: "Cost to serve",
  VARIATION_CONTRIBUTION: "Variation contribution",
  ABORTIVE_COST: "Abortive cost",
};

// A kind is a cost/leakage (shown red when non-zero) unless it's a contribution.
const IS_CONTRIBUTION = new Set(["VARIATION_CONTRIBUTION"]);

/** 27-management-control-tower.md rule 6 — profitability explainable per row via `economic_event`:
 *  totals by kind, then the per-unit contribution/leakage/quality-cost table. */
export function ProfitabilityView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Profitability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    managementApi.profitability(projectId).then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, [projectId]);

  useEffect(load, [load]);

  if (error) {
    return (
      <Card>
        <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy="true" aria-label="Loading profitability">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
    );
  }

  const kinds = Object.entries(data.totals_by_kind);

  return (
    <div className="flex flex-col gap-6">
      {kinds.length === 0 ? (
        <Card>
          <CardBody className="text-subhead text-fg-muted">No economic events recorded for this project yet.</CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kinds.map(([kind, amount]) => (
            <div key={kind} className="rounded-xl border border-line bg-surface-2 p-3">
              <div className="text-caption text-fg-subtle">{KIND_LABEL[kind] ?? kind}</div>
              <div className={cn("mt-1 font-mono text-body font-semibold tabular-nums", !IS_CONTRIBUTION.has(kind) && amount > 0 && "text-overdue")}>
                {formatINR(amount)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-title3 font-semibold">Per-unit contribution</h2>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {data.per_unit.length === 0 ? (
            <p className="text-subhead text-fg-muted">No per-unit economic events yet.</p>
          ) : (
            <table className="w-full min-w-[520px] text-footnote">
              <thead>
                <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                  <th className="p-2 text-left">Unit</th>
                  <th className="p-2 text-left">Contribution</th>
                  <th className="p-2 text-left">Leakage</th>
                  <th className="p-2 text-left">Quality cost</th>
                </tr>
              </thead>
              <tbody>
                {data.per_unit.map((u) => (
                  <tr key={u.unit_id} className="border-t border-line">
                    <td className="p-2 font-semibold">{u.unit_number}</td>
                    <td className="p-2 font-mono tabular-nums">{formatINR(u.contribution)}</td>
                    <td className={cn("p-2 font-mono tabular-nums", u.leakage > 0 && "text-overdue")}>{formatINR(u.leakage)}</td>
                    <td className={cn("p-2 font-mono tabular-nums", u.quality_cost > 0 && "text-overdue")}>{formatINR(u.quality_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-title3 font-semibold">Every economic event</h2>
          <p className="mt-1 text-footnote text-fg-muted">Each row is explainable back to its source fact (rule 6).</p>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {data.rows.length === 0 ? (
            <p className="text-subhead text-fg-muted">Nothing recorded yet.</p>
          ) : (
            <table className="w-full min-w-[560px] text-footnote">
              <thead>
                <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                  <th className="p-2 text-left">Kind</th>
                  <th className="p-2 text-left">Amount</th>
                  <th className="p-2 text-left">Reason</th>
                  <th className="p-2 text-left">Occurred</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="p-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="p-2 font-mono tabular-nums">{formatINR(r.amount_inr)}</td>
                    <td className="p-2 text-fg-muted">{r.reason ?? "—"}</td>
                    <td className="p-2 text-fg-muted">{formatIstDateTime(r.occurred_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
