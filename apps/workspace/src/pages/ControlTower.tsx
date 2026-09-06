import { useCallback, useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import { api } from "../api";
import type { Intervention } from "../api-lifecycle";
import { lifecycleApi } from "../api-lifecycle";
import { Card, CardBody, Button, Dialog, DialogContent, Tabs, TabsList, TabsTrigger } from "@homeflow/ui";
import { MoneyFigure } from "../ui/MoneyFigure";
import { cn, formatIstDateTime } from "../lib/utils";
import { interventionCategoryLabel } from "../lib/labels";
import { CashFlowPlanner } from "./finance/CashFlowPlanner";
import { PortfolioCompare } from "./finance/PortfolioCompare";
import { PortfolioView } from "./management/PortfolioView";
import { ProfitabilityView } from "./management/ProfitabilityView";
import { ExceptionsView } from "./management/ExceptionsView";
import { KpisView } from "./management/KpisView";
import { TeamBottlenecksView } from "./management/TeamBottlenecksView";

function DismissDialog({ item, onDismissed }: { item: Intervention; onDismissed: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await lifecycleApi.dismissIntervention(item.id, reason.trim());
      setOpen(false);
      setReason("");
      onDismissed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Dismiss
      </Button>
      <DialogContent title="Dismiss this intervention" description="Requires a reason (rule 2). Can't reappear for the same underlying issue for 14 days.">
        <div className="flex flex-col gap-3">
          <label className="text-footnote font-medium text-fg-muted">
            Reason (required)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
          </label>
          <Button onClick={dismiss} disabled={!reason.trim() || busy}>
            {busy ? "Dismissing…" : "Dismiss"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Interventions({ projectId }: { projectId: string }) {
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
      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
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
                      {interventionCategoryLabel(item.category)}
                      {item.status === "acted" && item.acted_at ? ` · Acted · ${formatIstDateTime(item.acted_at)}` : ""}
                      {item.status === "dismissed" ? " · Dismissed" : ""}
                    </div>
                    <h2 className="mt-1 text-title3 font-semibold">{item.headline}</h2>
                    <p className="mt-2 text-footnote text-fg-muted">{item.decision_pack.recommended_decision}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className={cn("text-footnote", item.decision_pack.impact.inr > 0 ? "text-fg" : "text-fg-subtle")}>
                        {item.decision_pack.impact.inr > 0 ? (
                          <MoneyFigure amount={item.decision_pack.impact.inr} risk="overdue" />
                        ) : (
                          "No rupee at risk"
                        )}
                      </span>
                      {item.decision_pack.impact.customers > 0 && (
                        <span className="text-footnote text-fg-muted">
                          {item.decision_pack.impact.customers} customer{item.decision_pack.impact.customers === 1 ? "" : "s"}
                        </span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setOpenId(expanded ? null : item.id)}>
                        {expanded ? "Hide pack" : "Decision pack"}
                      </Button>
                      {item.status === "open" && item.material && (
                        <>
                          <Button size="sm" onClick={() => act(item.id)} disabled={busy === item.id}>
                            Act
                          </Button>
                          <DismissDialog item={item} onDismissed={load} />
                        </>
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

type Tab = "interventions" | "portfolio" | "cash" | "planner" | "profitability" | "exceptions" | "kpis" | "teams";

/** Five interventions — not fifty charts (p21 §14). Extended (spec 27) with the Views tabs the
 *  spec names: Portfolio, Cash (reuses 20's Portfolio Comparison), Project Cash Flow (reuses 20's
 *  Cash Flow Planner), Profitability, Exceptions, KPIs (domain tabs + drill), Team bottlenecks.
 *  Project Performance / Experience / Execution are deliberately not built here — no dedicated
 *  backend combines 06/16/07/08's own data into a single view; see this spec's own Build note. */
export function ControlTower({ projectId, roles, onOpenProject }: { projectId: string; roles: string[]; onOpenProject: (projectId: string) => void }) {
  const [tab, setTab] = useState<Tab>("interventions");

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Control tower</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Five problems that need a decision today — a customer, cash, a handover, reputation, and margin.
        </p>
      </header>

      {/* shrink-0 on every trigger: without it, a flex child inside overflow-x-auto shrinks and
          wraps its own text (found live at 768px — "Project Cash Flow" broke onto 3 lines and the
          remaining tabs were pushed out of view) instead of the row scrolling horizontally. */}
      <div className="mb-6 overflow-x-auto">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="flex-nowrap">
            <TabsTrigger value="interventions" className="shrink-0 whitespace-nowrap">Interventions</TabsTrigger>
            <TabsTrigger value="portfolio" className="shrink-0 whitespace-nowrap">Portfolio</TabsTrigger>
            <TabsTrigger value="cash" className="shrink-0 whitespace-nowrap">Cash</TabsTrigger>
            <TabsTrigger value="planner" className="shrink-0 whitespace-nowrap">Project Cash Flow</TabsTrigger>
            <TabsTrigger value="profitability" className="shrink-0 whitespace-nowrap">Profitability</TabsTrigger>
            <TabsTrigger value="exceptions" className="shrink-0 whitespace-nowrap">Exceptions</TabsTrigger>
            <TabsTrigger value="kpis" className="shrink-0 whitespace-nowrap">KPIs</TabsTrigger>
            <TabsTrigger value="teams" className="shrink-0 whitespace-nowrap">Teams</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "interventions" && <Interventions projectId={projectId} />}
      {tab === "portfolio" && <PortfolioView onOpenProject={onOpenProject} />}
      {tab === "cash" && <PortfolioCompare onOpenProject={onOpenProject} />}
      {tab === "planner" && <CashFlowPlanner projectId={projectId} roles={roles} />}
      {tab === "profitability" && <ProfitabilityView projectId={projectId} />}
      {tab === "exceptions" && <ExceptionsView projectId={projectId} />}
      {tab === "kpis" && <KpisView projectId={projectId} />}
      {tab === "teams" && <TeamBottlenecksView projectId={projectId} />}
    </div>
  );
}
