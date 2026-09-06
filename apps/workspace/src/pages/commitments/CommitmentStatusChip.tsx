import { FileEdit, CheckCircle, PlayCircle, AlertTriangle, CheckCircle2, AlertOctagon, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { commitmentStatusLabel } from "../../lib/labels";
import type { CommitmentStatus } from "./api";

// commitment.status (13-promise-ledger.md Appendix A, 7-state) isn't one of StatusChip's
// JourneyStatus/GateState values (@homeflow/ui) — same "page-local chip for a separate closed set"
// precedent as journey/StageStatusChip.tsx. Icon + label, never colour alone.
const CONFIG: Record<CommitmentStatus, { icon: LucideIcon; tone: string }> = {
  DRAFT: { icon: FileEdit, tone: "bg-surface-raised text-fg-muted" },
  APPROVED: { icon: CheckCircle, tone: "bg-info-soft text-info-fg" },
  ACTIVE: { icon: PlayCircle, tone: "bg-info-soft text-info-fg" },
  AT_RISK: { icon: AlertTriangle, tone: "bg-warn-soft text-warn-fg" },
  FULFILLED: { icon: CheckCircle2, tone: "bg-ok-soft text-ok-fg" },
  BREACHED: { icon: AlertOctagon, tone: "bg-danger-soft text-danger-fg" },
  WAIVED_CANCELLED: { icon: XCircle, tone: "bg-surface-raised text-fg-subtle" },
};

export function CommitmentStatusChip({ status, className }: { status: CommitmentStatus; className?: string }) {
  const cfg = CONFIG[status] ?? CONFIG.DRAFT;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-ws-xs font-medium", cfg.tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      <span>{commitmentStatusLabel(status)}</span>
    </span>
  );
}
