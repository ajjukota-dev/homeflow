import { useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { Card, CardBody, EmptyState } from "@homeflow/ui";
import { qaApi, type QaExceptionRow } from "./api";

/** 15-qa-evidence-snags.md rule 3 — exception queue as a staff row list, not a comment. */
export function QaExceptionQueue({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<QaExceptionRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    setRows(null);
    qaApi
      .exceptions(projectId)
      .then(setRows)
      .catch(() => setError(true));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-title3 font-semibold">QA exception queue</h2>
      <p className="mb-4 max-w-2xl text-footnote text-fg-muted">
        Repeat QA failures (attempt 2+) on a component. Site declarations are not in this list.
      </p>
      {error && <EmptyState icon={Inbox} message="Couldn't load the exception queue." action={{ label: "Retry", onClick: load }} />}
      {!error && rows === null && (
        <div className="h-24 animate-pulse rounded-xl border border-line bg-surface-2" aria-busy="true" aria-label="Loading exception queue" />
      )}
      {!error && rows && rows.length === 0 && <EmptyState icon={Inbox} message="No QA exceptions for this project." />}
      {!error && rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <div>
                <div className="text-subhead font-semibold">
                  {r.unit_number} · {r.component_code}
                </div>
                <p className="text-footnote text-fg-muted">
                  {r.kind} · {r.status} · attempt {r.attempt_no} · {r.failures_on_component} QA failure(s)
                </p>
              </div>
              {r.failure_reason && <span className="text-footnote text-fg-muted">{r.failure_reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
