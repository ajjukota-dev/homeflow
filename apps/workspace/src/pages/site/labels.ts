import { CheckCircle2, CircleDashed, Wrench, ShieldCheck, RotateCcw, type LucideIcon } from "lucide-react";
import type { Freshness, SpecProgressState } from "./api";

// 07-unit-progress-control.md — state/freshness chip meta. Colour is never the sole signal
// (CLAUDE.md WCAG bar) — every chip pairs an icon with its label.
export const STATE_META: Record<SpecProgressState, { label: string; Icon: LucideIcon; className: string }> = {
  NOT_STARTED: { label: "Not started", Icon: CircleDashed, className: "text-fg-subtle bg-surface-2" },
  IN_PROGRESS: { label: "In progress", Icon: Wrench, className: "text-due bg-due/10" },
  COMPLETE: { label: "Complete", Icon: CheckCircle2, className: "text-ontrack bg-ontrack/10" },
  VERIFIED: { label: "Verified", Icon: ShieldCheck, className: "text-ontrack bg-ontrack/10" },
  REWORK: { label: "Rework", Icon: RotateCcw, className: "text-overdue bg-overdue/10" },
};

export const FRESHNESS_META: Record<Freshness, { label: string; className: string }> = {
  FRESH: { label: "Fresh", className: "bg-ontrack" },
  STALE: { label: "Stale — needs a fresh reading", className: "bg-due" },
  VERIFICATION_REQUIRED: { label: "Verification required — a gate depends on this", className: "bg-overdue" },
};

// Real matrix (seed/permissions.ts unit_readiness row): SITE=W, FM=W, QA mirrors the SITE column,
// SUPER_ADMIN gets WRITE everywhere. No nav path reaches FM to this page yet (flagged, not fixed
// here — out of this slice's scope), but the constant itself must match the matrix.
export const WRITE_ROLES = ["SITE", "QA", "FM", "SUPER_ADMIN"];

// Mirrors core.ts's assertStateAuthority exactly: SUPER_ADMIN sets anything, VERIFIED is QA's
// call, COMPLETE is SITE's declaration; FM (real unit_readiness WRITE per the matrix) can set the
// remaining states (not started/in progress/rework) same as SITE/QA.
export function canSetState(state: SpecProgressState, roles: string[]): boolean {
  if (roles.includes("SUPER_ADMIN")) return true;
  if (state === "VERIFIED") return roles.includes("QA");
  if (state === "COMPLETE") return roles.includes("SITE");
  return roles.includes("SITE") || roles.includes("QA") || roles.includes("FM");
}
