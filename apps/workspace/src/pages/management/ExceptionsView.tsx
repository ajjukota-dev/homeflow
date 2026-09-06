import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Badge } from "@homeflow/ui";
import { formatIstDateTime } from "../../lib/utils";
import { managementApi, type ExceptionRow } from "./api";

const KIND_LABEL: Record<string, string> = {
  STALE_GATE: "Stale gate",
  GATE_EXCEPTION: "Gate exception",
  ACTIVE_HOLD: "Active hold",
  CR_POST_FREEZE_OR_WAIVED: "Post-freeze / waived",
  CR_NEGATIVE_CONTRIBUTION: "Negative contribution",
  HANDOVER_OVERRIDE: "Handover override",
  FORECAST_MANUAL_OVERRIDE: "Forecast override",
};

/** 27-management-control-tower.md rule 5 (p34 §30.2) — every exception row names its own source
 *  and owner; no numeric "high value" cutoff exists anywhere in the spec set (UNCONFIRMED, same
 *  class as this backend's own already-flagged un-numbered thresholds) so every ACTIVE row shows. */
export function ExceptionsView({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [kind, setKind] = useState<string>("ALL");

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    managementApi
      .exceptions(projectId, kind === "ALL" ? undefined : kind)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId, kind]);

  useEffect(load, [load]);

  return (
    <div>
      <div className="mb-4">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-footnote">
          <option value="ALL">Every exception kind</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}
      {!error && loading && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading exceptions">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}
      {!error && !loading && rows.length === 0 && (
        <Card>
          <CardBody className="text-subhead text-fg-muted">No exceptions for this project right now.</CardBody>
        </Card>
      )}
      {!error && !loading && rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Card key={`${r.kind}:${r.id}`}>
              <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Badge tone="accent">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                  <div className="mt-1 text-body font-semibold">{r.headline}</div>
                  <div className="text-footnote text-fg-muted">
                    Owner {r.owner ?? "—"} · {formatIstDateTime(r.occurred_at)}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
