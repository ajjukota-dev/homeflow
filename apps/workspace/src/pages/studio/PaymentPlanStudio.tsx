import { useEffect, useState } from "react";
import { Button, Skeleton, EmptyState, PageHeader } from "@homeflow/ui";
import { CalendarClock } from "lucide-react";
import { paymentPlanApi, type PaymentPlan } from "./api";
import { PaymentPlanDrawer } from "./PaymentPlanDrawer";

/** Policy Studio's Payment plans tab (19-collections-true-risk.md Screens) — a bespoke screen,
 *  not GenericTableEditor: a plan is a parent row plus an ordered list of milestone rows, which
 *  the generic envelope's flat-column form can't represent (payment-plans.ts's design note). */
export function PaymentPlanStudio({ canEdit }: { canEdit: boolean }) {
  const [plans, setPlans] = useState<PaymentPlan[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<PaymentPlan | null | "new" | undefined>(undefined);

  function load() {
    setError(false);
    paymentPlanApi.list().then(setPlans).catch(() => setError(true));
  }
  useEffect(load, []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Payment plans"
        description="Construction-linked milestone schedules (19-collections-true-risk.md) — the % of consideration each milestone raises a demand for."
        actions={canEdit ? <Button onClick={() => setEditing("new")}>New plan</Button> : undefined}
      />

      {error && <EmptyState icon={CalendarClock} message="Couldn't load payment plans." action={{ label: "Retry", onClick: load }} />}
      {!error && plans === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && plans && plans.length === 0 && (
        <EmptyState icon={CalendarClock} message="No payment plans yet." action={canEdit ? { label: "Add the first plan", onClick: () => setEditing("new") } : undefined} />
      )}
      {!error && plans && plans.length > 0 && (
        <div className="flex flex-col gap-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded-lg border border-line p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-ws-body font-semibold text-fg">{p.name}</div>
                  <div className="text-footnote text-fg-muted">
                    {p.basis} · {p.project_id ?? "standard template"}
                  </div>
                </div>
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-left text-caption">
                  <thead className="text-footnote text-fg-muted">
                    <tr>
                      <th className="whitespace-nowrap py-1 pr-3">Seq</th>
                      <th className="whitespace-nowrap py-1 pr-3">Milestone</th>
                      <th className="whitespace-nowrap py-1 pr-3">Trigger</th>
                      <th className="whitespace-nowrap py-1 pr-3">% of consideration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.milestones.map((m) => (
                      <tr key={m.id ?? m.milestone_key} className="border-t border-line">
                        <td className="whitespace-nowrap py-1 pr-3">{m.sequence}</td>
                        <td className="whitespace-nowrap py-1 pr-3">{m.milestone_label}</td>
                        <td className="whitespace-nowrap py-1 pr-3 text-fg-muted">{m.construction_trigger_event ?? "—"}</td>
                        <td className="whitespace-nowrap py-1 pr-3">{m.pct_of_consideration}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <PaymentPlanDrawer
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}
