import { useCallback, useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import { api } from "../api";
import type { Intervention } from "../api-lifecycle";
import { Card, CardBody } from "../ui/Card";
import { Button } from "../ui/Button";
import { MoneyFigure } from "../ui/MoneyFigure";
import { cn } from "../lib/utils";

const LABELS: Record<string, string> = {
  customer: "Customer",
  cash: "Cash",
  handover: "Handover",
  reputation: "Reputation",
  margin: "Margin",
};

/** Five interventions — not fifty charts (management/spec.md §3.1). */
export function ControlTower({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .controlTower(projectId)
      .then((d) => setItems(d.interventions))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string) {
    setBusy(id);
    await api.actIntervention(id);
    await load();
    setBusy(null);
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Control tower</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Five problems that need a decision today — a customer, cash, a handover, reputation, and margin.
        </p>
      </header>
      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn’t reach the API on :3001.</CardBody>
        </Card>
      )}
      {loading && !error && (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Loading interventions">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => {
          const expanded = openId === item.id;
          return (
            <Card key={item.id} className={item.rank === 1 ? "md:col-span-2" : undefined}>
              <CardBody>
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-footnote font-bold">
                    {item.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-caption font-medium uppercase tracking-wide text-fg-subtle">
                      {LABELS[item.category] ?? item.category}
                      {item.status === "acted" ? " · acted" : ""}
                    </div>
                    <h2 className="mt-1 text-title3 font-semibold">{item.headline}</h2>
                    <p className="mt-2 text-footnote text-fg-muted">{item.decision_pack.recommended_decision}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className={cn("text-footnote", item.decision_pack.impact.rupee > 0 ? "text-fg" : "text-fg-subtle")}>
                        {item.decision_pack.impact.rupee > 0 ? (
                          <MoneyFigure amount={item.decision_pack.impact.rupee} risk="overdue" />
                        ) : (
                          "No rupee at risk"
                        )}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setOpenId(expanded ? null : item.id)}>
                        {expanded ? "Hide pack" : "Decision pack"}
                      </Button>
                      {item.status !== "acted" && item.material && (
                        <Button size="sm" onClick={() => act(item.id)} disabled={busy === item.id}>
                          Act
                        </Button>
                      )}
                    </div>
                    {expanded && (
                      <div className="mt-4 rounded-lg bg-surface-2 p-4 text-footnote">
                        <p>{item.decision_pack.what_happened}</p>
                        <p className="mt-2 text-fg-muted">Owner: {item.owner}</p>
                        <p className="mt-1 text-fg-muted">
                          Depends on {item.decision_pack.dependencies.join(", ") || "—"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
      {!loading && items.length === 0 && !error && (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <Landmark className="h-8 w-8 text-fg-subtle" />
            <p className="text-subhead text-fg-muted">The tower has nothing to show for this project.</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
