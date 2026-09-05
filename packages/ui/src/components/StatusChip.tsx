import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertOctagon,
  LockOpen,
  Lock,
  ShieldAlert,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useReducedMotion, transition } from "../motion";

/** Journey statuses (p-refs in docs/specs/06-timeline-sla-engine.md) + handover gate states
 * (docs/specs/16-handover-gates.md). Status is always icon + label — never colour alone. */
export type JourneyStatus =
  | "ON_TRACK"
  | "DUE_SOON"
  | "AT_RISK"
  | "OVERDUE"
  | "COMPLETED_ON_TIME"
  | "COMPLETED_LATE";
export type GateState = "OPEN" | "CLOSING" | "CONDITIONAL" | "EXCEPTION_ONLY" | "HARD_CLOSED";
export type StatusChipValue = JourneyStatus | GateState;

type Tone = "ok" | "info" | "warn" | "danger";

const CONFIG: Record<StatusChipValue, { tone: Tone; icon: LucideIcon; label: string }> = {
  ON_TRACK: { tone: "ok", icon: CheckCircle2, label: "On track" },
  DUE_SOON: { tone: "info", icon: Clock, label: "Due soon" },
  AT_RISK: { tone: "warn", icon: AlertTriangle, label: "At risk" },
  OVERDUE: { tone: "danger", icon: AlertOctagon, label: "Overdue" },
  COMPLETED_ON_TIME: { tone: "ok", icon: CheckCircle2, label: "Completed on time" },
  COMPLETED_LATE: { tone: "ok", icon: CheckCircle2, label: "Completed late" },
  OPEN: { tone: "ok", icon: LockOpen, label: "Open" },
  CLOSING: { tone: "info", icon: Clock, label: "Closing" },
  CONDITIONAL: { tone: "warn", icon: ShieldAlert, label: "Conditional" },
  EXCEPTION_ONLY: { tone: "warn", icon: ShieldOff, label: "Exception only" },
  HARD_CLOSED: { tone: "danger", icon: Lock, label: "Hard closed" },
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok-fg",
  info: "bg-info-soft text-info-fg",
  warn: "bg-warn-soft text-warn-fg",
  danger: "bg-danger-soft text-danger-fg",
};

export interface StatusChipProps {
  status: StatusChipValue;
  /** Override the default label (still shown alongside the icon). */
  label?: string;
  className?: string;
}

/** StatusChip — icon + label, morphs colour/icon on state change (Rule 6 authored moment). */
export function StatusChip({ status, label, className }: StatusChipProps) {
  const reduced = useReducedMotion();
  const cfg = CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-ws-xs font-medium",
        TONE_CLASS[cfg.tone],
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          className="inline-flex items-center gap-1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition("micro", reduced)}
        >
          <Icon className="size-3.5" aria-hidden />
          <span>{label ?? cfg.label}</span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
