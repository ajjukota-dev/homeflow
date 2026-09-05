import { AlertTriangle, Banknote, Clock, Handshake, Landmark, Scale } from "lucide-react";
import type { RiskBucket } from "../api";
import { cn } from "../lib/utils";

/** True-risk buckets (accounts/spec.md §2.3) — icon + label; colour is never the sole signal. */
export const BUCKET_META: Record<
  RiskBucket,
  { label: string; Icon: typeof Clock; tone: string }
> = {
  DUE: { label: "Due", Icon: Clock, tone: "text-due bg-due/10" },
  OVERDUE: { label: "Overdue", Icon: AlertTriangle, tone: "text-atrisk bg-atrisk/10" },
  DISPUTED: { label: "Disputed", Icon: Scale, tone: "text-fg-muted bg-surface-2" },
  LOAN_DEPENDENT: { label: "Loan-dependent", Icon: Landmark, tone: "text-accent bg-accent/10" },
  PROMISE_TO_PAY: { label: "Promise to pay", Icon: Handshake, tone: "text-fg-muted bg-surface-2" },
  TRUE_RISK: { label: "True risk", Icon: Banknote, tone: "text-overdue bg-overdue/10" },
};

export function BucketChip({ bucket }: { bucket: RiskBucket }) {
  const m = BUCKET_META[bucket];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-footnote font-medium", m.tone)}>
      <m.Icon className="h-3.5 w-3.5" aria-hidden />
      {m.label}
    </span>
  );
}
