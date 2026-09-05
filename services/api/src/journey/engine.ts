// Pure engine (06-timeline-sla-engine.md rules 2, 4, 6) — status derivation and stage
// scheduling never touch the DB, so both are unit-tested in isolation
// (00-conventions.md "Explicit boundaries").
import { addWorkingDays, type CalendarRow } from "./calendar";

export type ClockStatus = "ON_TRACK" | "DUE_SOON" | "AT_RISK" | "OVERDUE" | "COMPLETED_ON_TIME" | "COMPLETED_LATE";

export interface DeriveStatusInput {
  now: string; // ISO instant
  dueAt: string | null;
  stoppedAt: string | null;
  outcome: "ON_TIME" | "LATE" | null;
  dueSoonLeadDays: number;
  /** True when the at_risk_rule fires: blocked, forecast > planned, or a dependency overdue —
   *  computed by the caller (instances.ts), since it needs data this pure function shouldn't. */
  atRisk: boolean;
}

/** Rule 6: read-time, pure, never stored as user input. Order matters — a stopped clock is
 *  always COMPLETED_*, then OVERDUE beats DUE_SOON beats AT_RISK beats ON_TRACK. */
export function deriveStatus(input: DeriveStatusInput): ClockStatus {
  if (input.stoppedAt) return input.outcome === "LATE" ? "COMPLETED_LATE" : "COMPLETED_ON_TIME";
  if (!input.dueAt) return input.atRisk ? "AT_RISK" : "ON_TRACK";

  const now = new Date(input.now).getTime();
  const due = new Date(input.dueAt).getTime();
  if (now > due) return "OVERDUE";

  const dueSoonThreshold = due - input.dueSoonLeadDays * 24 * 60 * 60 * 1000;
  if (now >= dueSoonThreshold) return "DUE_SOON";
  if (input.atRisk) return "AT_RISK";
  return "ON_TRACK";
}

export interface StageScheduleInput {
  code: string;
  planned_duration_days: number;
}

export interface StageEdge {
  from: string; // stage code
  to: string; // stage code
  lag_days: number;
}

export interface StageWindow {
  start: string;
  end: string;
}

/** Rule 2 (baseline from planned_duration_days along the dependency graph) + rule 4 (a stage
 *  starts when ITS dependencies are met, not when the previous numbered stage completes) —
 *  Kahn's-algorithm forward pass over stage-level edges (task-level `journey_dependency`
 *  rolled up to the stages that own each task_code — see instances.ts's `deriveStageEdges`).
 *  A stage with no incoming edge starts on `journeyStartDate`. Cyclic input throws (should be
 *  unreachable — 05 rule 5 already refuses to publish a version whose dependencies cycle). */
export function computeStageSchedule(
  stages: StageScheduleInput[],
  edges: StageEdge[],
  journeyStartDate: string,
  calendar: CalendarRow
): Map<string, StageWindow> {
  const byCode = new Map(stages.map((s) => [s.code, s]));
  const incoming = new Map<string, StageEdge[]>();
  for (const s of stages) incoming.set(s.code, []);
  for (const e of edges) {
    if (!incoming.has(e.to)) continue; // edge into a stage not in this version (shouldn't happen)
    incoming.get(e.to)!.push(e);
  }

  const windows = new Map<string, StageWindow>();
  const resolved = new Set<string>();
  let progress = true;
  while (resolved.size < stages.length && progress) {
    progress = false;
    for (const stage of stages) {
      if (resolved.has(stage.code)) continue;
      const preds = incoming.get(stage.code) ?? [];
      if (!preds.every((e) => resolved.has(e.from))) continue;

      const start =
        preds.length === 0
          ? journeyStartDate
          : preds.reduce((latest, e) => {
              const predEnd = windows.get(e.from)!.end;
              const withLag = e.lag_days > 0 ? addWorkingDays(predEnd, e.lag_days, calendar) : predEnd;
              return withLag > latest ? withLag : latest;
            }, journeyStartDate);
      const end = addWorkingDays(start, byCode.get(stage.code)!.planned_duration_days, calendar);
      windows.set(stage.code, { start, end });
      resolved.add(stage.code);
      progress = true;
    }
  }
  if (resolved.size < stages.length) {
    throw new Error("computeStageSchedule: cyclic stage dependency graph");
  }
  return windows;
}

export interface TaskDependencyEdge {
  from_task_code: string;
  to_task_code: string;
  lag_days: number;
}

/** Rolls 05's task-level `journey_dependency` up to stage-level edges for `computeStageSchedule`
 *  — a stage depends on another stage only when one of its tasks depends on a task owned by
 *  that other stage. Same-stage edges (from and to both belong to the same stage) are dropped:
 *  they don't affect stage-to-stage scheduling. Duplicate stage pairs keep the longest lag. */
export function deriveStageEdges(taskStageCode: Map<string, string>, deps: TaskDependencyEdge[]): StageEdge[] {
  const byPair = new Map<string, StageEdge>();
  for (const d of deps) {
    const fromStage = taskStageCode.get(d.from_task_code);
    const toStage = taskStageCode.get(d.to_task_code);
    if (!fromStage || !toStage || fromStage === toStage) continue;
    const key = `${fromStage}->${toStage}`;
    const existing = byPair.get(key);
    if (!existing || d.lag_days > existing.lag_days) {
      byPair.set(key, { from: fromStage, to: toStage, lag_days: d.lag_days });
    }
  }
  return [...byPair.values()];
}
