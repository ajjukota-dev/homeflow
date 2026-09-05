// 14-readiness-scores.md: the shared Score contract (p8 §6) — every score endpoint returns
// exactly this shape. Pure, framework-free (00-conventions.md "explicit boundaries").

export type ScoreType = "UNIT_READINESS" | "BOOKING_READINESS" | "HANDOVER_READINESS";
export type Trend = "UP" | "FLAT" | "DOWN";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface ScoreDriver {
  code: string;
  label: string;
  contribution: number;
  fact: string;
}

export interface ScoreAction {
  action_type: string;
  title: string;
  target?: string | null;
}

export interface Score {
  value: number;
  trend: Trend;
  drivers: ScoreDriver[];
  confidence: Confidence;
  confidence_reason: string;
  actions: ScoreAction[];
}

/** Rule 4: trend = sign of change vs the snapshot ~7 days earlier. */
export function trendFrom(current: number, previous: number | null): Trend {
  if (previous === null) return "FLAT";
  if (current > previous + 1e-9) return "UP";
  if (current < previous - 1e-9) return "DOWN";
  return "FLAT";
}

/** Rule 1's "drivers = three largest" — reused by every score type, not re-derived per file. */
export function topDrivers(all: ScoreDriver[], n = 3): ScoreDriver[] {
  return [...all].sort((a, b) => b.contribution - a.contribution).slice(0, n);
}
