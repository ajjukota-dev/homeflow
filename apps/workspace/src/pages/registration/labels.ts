import { Circle, Loader2, CheckCircle2, CalendarCheck, CalendarClock, Stamp, Award, Ban } from "lucide-react";
import type { RegStatus } from "./api";

// Icon + label, never colour alone (CLAUDE.md's UI bar) — same local STATUS_META convention as
// SpecificationBaselinesStudio.tsx/documents/labels.ts's own status maps.
export const STATUS_META: Record<RegStatus, { icon: typeof Circle; label: string; className: string }> = {
  NOT_READY: { icon: Circle, label: "Not ready", className: "bg-surface-2 text-fg-subtle" },
  READINESS_IN_PROGRESS: { icon: Loader2, label: "Readiness in progress", className: "bg-due/10 text-due" },
  READY: { icon: CheckCircle2, label: "Ready", className: "bg-ok-soft text-ok-fg" },
  AVAILABILITY_CONFIRMED: { icon: CalendarCheck, label: "Availability confirmed", className: "bg-ok-soft text-ok-fg" },
  SLOT_BOOKED: { icon: CalendarClock, label: "Slot booked", className: "bg-accent/10 text-accent" },
  EXECUTED: { icon: Stamp, label: "Executed", className: "bg-accent/10 text-accent" },
  COMPLETED: { icon: Award, label: "Completed", className: "bg-ontrack/10 text-ontrack" },
  CANCELLED: { icon: Ban, label: "Cancelled", className: "bg-overdue/10 text-overdue" },
};

export const STATUS_ORDER: RegStatus[] = ["NOT_READY", "READINESS_IN_PROGRESS", "READY", "AVAILABILITY_CONFIRMED", "SLOT_BOOKED", "EXECUTED", "COMPLETED", "CANCELLED"];

// 7 of the 8 facts gate READY (readiness/readiness.ts's allHardOk); customer_availability is
// explicitly excluded there and tracked separately via rule 2's own AVAILABILITY_CONFIRMED status.
export const READINESS_LABELS: Record<string, string> = {
  documents: "Customer documents",
  clearance: "Financial clearance",
  tds: "TDS",
  agreement_executed: "Agreement of sale executed",
  sale_deed_ready: "Sale deed ready",
  signatories: "Signatory KYC",
  poa_valid: "Power of attorney",
  customer_availability: "Customer availability (not a READY gate)",
};
export const HARD_READINESS_KEYS = ["documents", "clearance", "tds", "agreement_executed", "sale_deed_ready", "signatories", "poa_valid"] as const;

export const CONFIDENCE_META: Record<"LOW" | "MEDIUM" | "HIGH", { label: string; className: string }> = {
  HIGH: { label: "High confidence", className: "bg-ok-soft text-ok-fg" },
  MEDIUM: { label: "Medium confidence", className: "bg-due/10 text-due" },
  LOW: { label: "Low confidence", className: "bg-surface-2 text-fg-subtle" },
};
