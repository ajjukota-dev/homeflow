import { FileEdit, Send, RotateCcw, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { handoverStatusLabel } from "../../lib/labels";
import type { HandoverStatus } from "./api";

// SalesHandover.status (17-sales-crm-handover.md) isn't one of StatusChip's JourneyStatus/
// GateState values (@homeflow/ui) — same page-local-chip precedent as commitments/CommitmentStatusChip.tsx.
const CONFIG: Record<HandoverStatus, { icon: LucideIcon; tone: string }> = {
  DRAFT: { icon: FileEdit, tone: "bg-surface-raised text-fg-muted" },
  SUBMITTED: { icon: Send, tone: "bg-info-soft text-info-fg" },
  RETURNED: { icon: RotateCcw, tone: "bg-warn-soft text-warn-fg" },
  ACCEPTED: { icon: CheckCircle2, tone: "bg-ok-soft text-ok-fg" },
};

export function HandoverStatusChip({ status, className }: { status: HandoverStatus; className?: string }) {
  const cfg = CONFIG[status] ?? CONFIG.DRAFT;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-ws-xs font-medium", cfg.tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      <span>{handoverStatusLabel(status)}</span>
    </span>
  );
}
