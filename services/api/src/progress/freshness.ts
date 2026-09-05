import type { ProgressState } from "../gates";

// 07-unit-progress-control.md rule 6. Pure, framework-free — derived at read, never stored.

export type FreshnessStatus = "FRESH" | "STALE" | "VERIFICATION_REQUIRED";

export interface FreshnessInput {
  state: ProgressState;
  updatedAt: string;
  staleAfterDays: number;
  /** true when at least one change_gate_rule triggers on this component (a gate depends on it). */
  gateDependent: boolean;
  asOf?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** STALE only while IN_PROGRESS and past the component's threshold; VERIFICATION_REQUIRED when a
 *  gate depends on that stale reading. Terminal/idle states are never stale — a component that
 *  is NOT_STARTED or COMPLETE isn't "going stale", it's just its state. */
export function deriveFreshness(input: FreshnessInput): FreshnessStatus {
  if (input.state !== "in_progress" && input.state !== "rework") return "FRESH";
  const asOf = input.asOf ? Date.parse(input.asOf) : Date.now();
  const ageDays = (asOf - Date.parse(input.updatedAt)) / DAY_MS;
  if (ageDays <= input.staleAfterDays) return "FRESH";
  return input.gateDependent ? "VERIFICATION_REQUIRED" : "STALE";
}
