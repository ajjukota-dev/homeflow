import { useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import {
  api,
  type CollectionItem,
  type CollectionsView,
  type OverdueReason,
  type RiskBucket,
} from "../api";
import { Card, CardBody } from "../ui/Card";
import { Button } from "../ui/Button";
import { MoneyFigure } from "../ui/MoneyFigure";
import { BucketChip } from "../ui/BucketChip";
import { CollectionBuckets } from "./CollectionBuckets";
import { BUCKET_META } from "../ui/BucketChip";

/** Accounts — true-risk collections workbench (accounts/spec.md §3.1 A). */
export function Collections({ projectId }: { projectId: string }) {
  const [view, setView] = useState<CollectionsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<RiskBucket | "ALL">("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<OverdueReason[]>([]);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([api.collections(projectId), api.overdueReasons()])
      .then(([v, r]) => {
        setView(v);
        setReasons(r);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const items =
    !view ? [] : selected === "ALL"
      ? Object.values(view.buckets).flatMap((b) => b.items)
      : view.buckets[selected].items;

  async function receive(row: CollectionItem) {
    setBusy(row.demand_id);
    await api.postReceipt(row.demand_id, row.amount, crypto.randomUUID());
    await load();
    setBusy(null);
  }

  async function promise(row: CollectionItem) {
    const when = new Date();
    when.setDate(when.getDate() + 7);
    setBusy(row.demand_id);
    await api.recordPtp(row.demand_id, when.toISOString().slice(0, 10), row.amount);
    await load();
    setBusy(null);
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Collections</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          What is due, overdue, disputed, waiting on a bank, promised, or truly at risk — never one scary number.
        </p>
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn’t reach the API on :3001.</CardBody>
        </Card>
      )}
      {loading && !error && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-busy="true" aria-label="Loading collections">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}

      {!loading && view && (
        <>
          <CollectionBuckets view={view} selected={selected} onSelect={setSelected} />

          <h2 className="mb-3 mt-8 text-title3 font-semibold">
            {selected === "ALL" ? "Open amounts" : `${BUCKET_META[selected].label} queue`}
          </h2>
          {items.length === 0 ? (
            <Card>
              <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
                <Inbox className="h-8 w-8 text-fg-subtle" />
                <p className="text-subhead text-fg-muted">Nothing in this bucket right now.</p>
              </CardBody>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((row) => (
                <Card key={row.demand_id}>
                  <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div>
                      <div className="text-headline font-semibold">{row.customer_name}</div>
                      <div className="text-footnote text-fg-muted">
                        Villa {row.unit_number} · {row.milestone_label}
                        {row.ageing_days > 0 ? ` · ${row.ageing_days} days past due` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <BucketChip bucket={row.bucket} />
                        {row.next_action && (
                          <span className="text-footnote text-fg-muted">Next: {row.next_action}</span>
                        )}
                        {row.overdue_reason_code && (
                          <span className="text-caption text-fg-subtle">
                            {reasons.find((r) => r.code === row.overdue_reason_code)?.label ?? row.overdue_reason_code}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="sm:ml-auto sm:text-right">
                      <MoneyFigure
                        amount={row.amount}
                        risk={row.bucket === "TRUE_RISK" || row.bucket === "OVERDUE" ? "overdue" : row.bucket === "DUE" ? "due" : "none"}
                      />
                      <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
                        {(row.bucket === "DUE" || row.bucket === "OVERDUE" || row.bucket === "TRUE_RISK") && (
                          <Button size="sm" onClick={() => receive(row)} disabled={busy === row.demand_id}>
                            Post receipt
                          </Button>
                        )}
                        {row.bucket !== "PROMISE_TO_PAY" && row.bucket !== "DISPUTED" && (
                          <Button size="sm" variant="tinted" onClick={() => promise(row)} disabled={busy === row.demand_id}>
                            Record PTP
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
