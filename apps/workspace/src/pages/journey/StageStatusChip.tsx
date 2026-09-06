import { Circle, Clock, PauseCircle, AlertOctagon, CheckCircle2, MinusCircle, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

// stage_instance.status (06-timeline-sla-engine.md Data table) isn't one of StatusChip's
// JourneyStatus/GateState values (@homeflow/ui) — a separate, small closed set, so this stays a
// page-local chip rather than widening the shared component's type union for one consumer.
// Same "icon + label, never colour alone" contract as StatusChip.
export type StageStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "BLOCKED" | "COMPLETED" | "NOT_APPLICABLE";

const CONFIG: Record<StageStatus, { icon: LucideIcon; label: string; tone: string }> = {
  NOT_STARTED: { icon: Circle, label: "Not started", tone: "bg-surface-raised text-fg-muted" },
  IN_PROGRESS: { icon: Clock, label: "In progress", tone: "bg-info-soft text-info-fg" },
  WAITING: { icon: PauseCircle, label: "Waiting", tone: "bg-warn-soft text-warn-fg" },
  BLOCKED: { icon: AlertOctagon, label: "Blocked", tone: "bg-danger-soft text-danger-fg" },
  COMPLETED: { icon: CheckCircle2, label: "Completed", tone: "bg-ok-soft text-ok-fg" },
  NOT_APPLICABLE: { icon: MinusCircle, label: "N/A", tone: "bg-surface-raised text-fg-subtle" },
};

export function StageStatusChip({ status, className }: { status: StageStatus; className?: string }) {
  const cfg = CONFIG[status] ?? CONFIG.NOT_STARTED;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-ws-xs font-medium", cfg.tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      <span>{cfg.label}</span>
    </span>
  );
}
