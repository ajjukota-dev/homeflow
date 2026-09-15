import { db } from "../db";
import { runAsSystem } from "../db/rls-context";
import { todayIst } from "../authz/clock";
import { sweepOverdueDemands } from "../collections-sweep";
import { sweepLoanValidity } from "../loans/sweep";
import { scanHolds } from "../sales/holds";
import { takeSnapshot } from "../forecast/core";

// Phase 3 clock: call the four existing sweeps (19 overdue, 21 loan validity, 24 hold
// expiry, 20 forecast snapshot). asOf is injected so tests never sleep on the wall clock.

export interface SchedulerDeps {
  overdue: (asOf: string) => Promise<unknown[]>;
  loans: (asOf: string) => Promise<unknown[]>;
  holds: (asOf: string) => Promise<{ expired: string[] }>;
  snapshot: (
    projectId: string,
    kind: "MONTH_START" | "WEEKLY" | "MANUAL",
    ctx: undefined,
    asOf: string
  ) => Promise<{ id: string }>;
  projectIds: () => Promise<string[]>;
}

async function defaultProjectIds(): Promise<string[]> {
  const r = await db.query<{ id: string }>(`SELECT id FROM project ORDER BY id`);
  return r.rows.map((row) => row.id);
}

const defaults: SchedulerDeps = {
  overdue: (asOf) => sweepOverdueDemands(asOf),
  loans: (asOf) => sweepLoanValidity(asOf),
  holds: (asOf) => scanHolds(asOf),
  snapshot: (projectId, kind, ctx, asOf) => takeSnapshot(projectId, kind, ctx, asOf),
  projectIds: defaultProjectIds,
};

/** Spec 20: MONTH_START on calendar day 1, otherwise the weekly snapshot. */
function snapshotKind(asOf: string): "MONTH_START" | "WEEKLY" {
  return asOf.slice(8, 10) === "01" ? "MONTH_START" : "WEEKLY";
}

export async function runOnce(
  asOf?: string,
  deps: SchedulerDeps = defaults
): Promise<{ overdue: number; loans: number; holds: string[]; snapshots: string[] }> {
  return runAsSystem(async () => {
    const day = asOf ?? todayIst();
    const kind = snapshotKind(day);
    const overdueRows = await deps.overdue(day);
    const loanRows = await deps.loans(day);
    const holdResult = await deps.holds(day);

    const snapshots: string[] = [];
    for (const projectId of await deps.projectIds()) {
      try {
        const snap = await deps.snapshot(projectId, kind, undefined, day);
        snapshots.push(snap.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] snapshot failed for ${projectId}: ${message}`);
      }
    }

    return {
      overdue: overdueRows.length,
      loans: loanRows.length,
      holds: holdResult.expired,
      snapshots,
    };
  });
}
