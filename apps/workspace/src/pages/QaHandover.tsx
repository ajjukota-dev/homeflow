import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, CircleDashed } from "lucide-react";
import { api } from "../api";
import type { HandoverRow, ReadinessRow } from "../api-lifecycle";
import { Card, CardBody } from "../ui/Card";
import { Button } from "../ui/Button";
import { ScoreDial } from "../ui/ScoreDial";
import { cn } from "../lib/utils";

/** QA evidence + handover eligibility (qa/spec.md §3.1). */
export function QaHandover({ projectId }: { projectId: string }) {
  const [units, setUnits] = useState<ReadinessRow[]>([]);
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([api.readiness(projectId), api.handover(projectId)])
      .then(([u, h]) => {
        setUnits(u);
        setHandovers(h);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    }
    setBusy(null);
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">QA & handover</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Readiness comes from evidence, not a typed percentage. Keys wait on every hard gate.
        </p>
      </header>
      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn’t reach the API on :3001.</CardBody>
        </Card>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-due/10 px-4 py-3 text-subhead text-due">
          {notice.replace("handover_not_eligible", "This villa is not eligible for keys yet.")}
        </p>
      )}
      {loading && !error && (
        <div className="h-40 animate-pulse rounded-xl border border-line bg-surface-2" aria-busy="true" aria-label="Loading readiness" />
      )}
      {!loading && units.length === 0 && !error && (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <ClipboardCheck className="h-8 w-8 text-fg-subtle" />
            <p className="text-subhead text-fg-muted">No booked villas to inspect yet.</p>
          </CardBody>
        </Card>
      )}

      <h2 className="mb-3 text-title3 font-semibold">Unit readiness</h2>
      <div className="flex flex-col gap-3">
        {units.map((u) => (
          <Card key={u.id}>
            <CardBody className="flex flex-col gap-4 sm:flex-row">
              <ScoreDial value={u.value} label="From evidence" />
              <div className="min-w-0 flex-1">
                <div className="text-headline font-semibold">
                  {u.customer_name} · Villa {u.unit_number}
                </div>
                <p className="mt-1 text-footnote text-fg-muted">{u.drivers[0]}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {u.components.map((c) => (
                    <li key={c.code}>
                      {c.qa_verified ? (
                        <span className="rounded-full bg-ontrack/10 px-2.5 py-1 text-footnote font-medium text-ontrack">
                          {c.label} verified
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="tinted"
                          onClick={() => run(`${u.id}-${c.code}`, () => api.verifyQa(u.id, c.code))}
                          disabled={busy === `${u.id}-${c.code}`}
                        >
                          Verify {c.label}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {u.snags.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {u.snags.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 text-footnote">
                        <span className={cn("rounded-full px-2 py-0.5 font-medium", s.severity === "critical" ? "bg-overdue/10 text-overdue" : "bg-due/10 text-due")}>
                          {s.severity}
                        </span>
                        <span>{s.description}</span>
                        {s.status !== "closed" && (
                          <Button size="sm" variant="ghost" onClick={() => run(s.id, () => api.closeSnag(s.id))} disabled={busy === s.id}>
                            Verify & close
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-title3 font-semibold">Handover gates</h2>
      <div className="flex flex-col gap-3">
        {handovers.map((h) => (
          <Card key={h.booking_id}>
            <CardBody>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <div className="text-headline font-semibold">
                    {h.customer_name} · Villa {h.unit_number}
                  </div>
                  <p className="mt-1 text-footnote text-fg-muted">
                    {h.lifecycle === "completed" ? "Keys issued" : h.eligible ? "Eligible for keys" : "Not eligible yet"}
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {h.gates
                      .filter((g) => g.classification === "hard" || g.type === "commitments")
                      .map((g) =>
                        g.type === "commitments" ? (
                          // No Promise Ledger yet (TODO.md task 6) — always shown, never silently passed.
                          <li
                            key={g.type}
                            className="inline-flex items-center gap-1.5 rounded-full bg-due/10 px-2.5 py-1 text-caption font-medium text-due"
                          >
                            <CircleDashed className="h-3 w-3" aria-hidden />
                            Commitments · Not verified
                            <span className="font-normal text-fg-subtle">· {g.blockers[0]}</span>
                          </li>
                        ) : (
                          <li
                            key={g.type}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-caption font-medium",
                              g.state === "passed" ? "bg-ontrack/10 text-ontrack" : "bg-surface-2 text-fg-muted"
                            )}
                          >
                            {g.type} · {g.state === "passed" ? "passed" : "open"}
                          </li>
                        )
                      )}
                  </ul>
                  {h.blockers.length > 0 && h.lifecycle !== "completed" && (
                    <ul className="mt-2 list-disc pl-5 text-footnote text-fg-muted">
                      {h.blockers.slice(0, 3).map((b) => (
                        <li key={b.gate + b.reason}>{b.reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {h.lifecycle !== "completed" && (
                  <Button
                    size="sm"
                    onClick={() => run(h.booking_id, () => api.completeHandover(h.booking_id))}
                    disabled={!h.eligible || busy === h.booking_id}
                  >
                    Complete handover
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
