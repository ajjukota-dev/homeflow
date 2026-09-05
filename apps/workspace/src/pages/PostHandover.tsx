import { useCallback, useEffect, useState } from "react";
import { HeartHandshake } from "lucide-react";
import { api } from "../api";
import type { ServiceEvent, WarrantyView } from "../api-lifecycle";
import { Card, CardBody, Button } from "@homeflow/ui";
import { dlpWindowStatusLabel, warrantyCaseStatusLabel } from "../lib/labels";

/** DLP, warranty cases, check-ins, unit service history (post-handover/spec.md §3.1). */
export function PostHandover({ projectId }: { projectId: string }) {
  const [view, setView] = useState<WarrantyView | null>(null);
  const [history, setHistory] = useState<ServiceEvent[] | null>(null);
  const [historyUnit, setHistoryUnit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .warranty(projectId)
      .then(setView)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    await fn();
    await load();
    if (historyUnit) setHistory(await api.serviceHistory(historyUnit));
    setBusy(null);
  }

  async function openHistory(unitId: string) {
    setHistoryUnit(unitId);
    setHistory(await api.serviceHistory(unitId));
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">After keys</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Defect-liability windows, warranty cases, and a service history that stays on the home.
        </p>
      </header>
      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn’t reach the API on :3001.</CardBody>
        </Card>
      )}
      {loading && !error && (
        <div className="h-36 animate-pulse rounded-xl border border-line bg-surface-2" aria-busy="true" aria-label="Loading warranty board" />
      )}
      {!loading && view && view.windows.length === 0 && (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <HeartHandshake className="h-8 w-8 text-fg-subtle" />
            <p className="text-subhead text-fg-muted">No homes in the defect-liability window yet.</p>
          </CardBody>
        </Card>
      )}

      {view && view.windows.length > 0 && (
        <>
          <h2 className="mb-3 text-title3 font-semibold">Defect-liability windows</h2>
          <div className="flex flex-col gap-3">
            {view.windows.map((w) => (
              <Card key={w.id}>
                <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div>
                    <div className="text-headline font-semibold">
                      {w.customer_name} · Villa {w.unit_number}
                    </div>
                    <p className="text-footnote text-fg-muted">
                      {w.policy_months}-month cover · {String(w.dlp_start).slice(0, 10)} to {String(w.dlp_end).slice(0, 10)} · {dlpWindowStatusLabel(w.status)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" className="sm:ml-auto" onClick={() => openHistory(w.unit_id)}>
                    Service history
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}

      {view && (
        <>
          <h2 className="mb-3 mt-8 text-title3 font-semibold">Warranty cases</h2>
          {view.cases.length === 0 ? (
            <p className="text-subhead text-fg-muted">No open warranty work.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {view.cases.map((c) => (
                <Card key={c.id}>
                  <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div>
                      <div className="text-headline font-semibold">{c.description}</div>
                      <p className="text-footnote text-fg-muted">
                        {c.customer_name} · Villa {c.unit_number} · {c.coverage === "out_of_coverage" ? "Chargeable" : "Covered"} · {warrantyCaseStatusLabel(c.status)}
                      </p>
                    </div>
                    {c.status !== "closed" && (
                      <Button size="sm" className="sm:ml-auto" onClick={() => run(c.id, () => api.closeWarranty(c.id))} disabled={busy === c.id}>
                        Close case
                      </Button>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

          <h2 className="mb-3 mt-8 text-title3 font-semibold">Settling-in check-ins</h2>
          <div className="flex flex-col gap-3">
            {view.checkins.map((c) => (
              <Card key={c.id}>
                <CardBody className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-subhead font-semibold">
                      Day {c.day} · {c.customer_name} · Villa {c.unit_number}
                    </div>
                    <p className="text-footnote text-fg-muted">
                      {c.status === "captured" ? `Captured · ${c.satisfaction_score}/5` : "Scheduled"}
                    </p>
                  </div>
                  {c.status !== "captured" && (
                    <Button size="sm" variant="secondary" onClick={() => run(c.id, () => api.captureCheckin(c.id))} disabled={busy === c.id}>
                      Capture
                    </Button>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}

      {history && (
        <section className="mt-8" aria-live="polite">
          <h2 className="mb-3 text-title3 font-semibold">Permanent ledger</h2>
          <Card>
            <CardBody>
              <ol className="space-y-3">
                {history.map((e) => (
                  <li key={e.id}>
                    <div className="text-subhead font-semibold">{e.description}</div>
                    <div className="text-caption text-fg-subtle">
                      {e.actor} · {String(e.occurred_at).slice(0, 10)}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </section>
      )}
    </div>
  );
}
