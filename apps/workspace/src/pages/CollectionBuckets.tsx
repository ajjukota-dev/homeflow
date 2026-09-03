import type { CollectionsView, RiskBucket } from "../api";
import { MoneyFigure, formatINR } from "../ui/MoneyFigure";
import { BUCKET_META } from "../ui/BucketChip";
import { cn } from "../lib/utils";

const ORDER: RiskBucket[] = [
  "DUE",
  "OVERDUE",
  "DISPUTED",
  "LOAN_DEPENDENT",
  "PROMISE_TO_PAY",
  "TRUE_RISK",
];

/** Six-bucket board — outstanding is captioned separately, never the only number. */
export function CollectionBuckets({
  view,
  selected,
  onSelect,
}: {
  view: CollectionsView;
  selected: RiskBucket | "ALL";
  onSelect: (b: RiskBucket | "ALL") => void;
}) {
  return (
    <div>
      <p className="mb-3 text-footnote text-fg-subtle">
        Raw outstanding {formatINR(view.outstanding_total)} — not a risk number. Split below is what to work.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" role="tablist" aria-label="Collection buckets">
        {ORDER.map((key) => {
          const meta = BUCKET_META[key];
          const active = selected === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(active ? "ALL" : key)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                active ? "border-fg bg-surface-2" : "border-line bg-surface hover:bg-surface-2"
              )}
            >
              <span className={cn("inline-flex items-center gap-1.5 text-caption font-medium", meta.tone.split(" ")[0])}>
                <meta.Icon className="h-3.5 w-3.5" aria-hidden />
                {meta.label}
              </span>
              <div className="mt-2 text-title3">
                <MoneyFigure amount={view.buckets[key].amount} risk={key === "TRUE_RISK" ? "overdue" : key === "DUE" ? "due" : "none"} />
              </div>
              <div className="mt-0.5 text-caption text-fg-subtle">
                {view.buckets[key].items.length} open
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
