// 27-management-control-tower.md rule 8 — "table, not charts": actions by department with SLA
// state, median age, top blockers. `action` has no `created_at` column (same gap 11's myday
// already found) — age is derived from its own `action.created` event, matching 11's precedent.

import { db } from "../db";
import { authorize } from "../authz/authorize";
import type { Ctx } from "../authz/types";

export interface DepartmentRow {
  owner_role: string;
  open_count: number;
  on_track: number;
  overdue: number;
  breached: number;
  median_age_days: number | null;
  top_blockers: { reason: string; count: number }[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export async function getTeamBottlenecks(projectId: string, ctx: Ctx): Promise<DepartmentRow[]> {
  await authorize(ctx, "reports", "READ");
  const actions = await db.query<{
    owner_role: string; status: string; blocking_reason: string | null; due_at: string | null; outcome: string | null;
    created_at: string;
  }>(
    `SELECT a.owner_role, a.status, a.blocking_reason, a.due_at::text AS due_at, sc.outcome,
            COALESCE((SELECT MIN(occurred_at)::text FROM event WHERE entity_type = 'action' AND entity_id = a.id AND type = 'action.created'), now()::text) AS created_at
       FROM action a LEFT JOIN sla_clock sc ON sc.id = a.sla_clock_id
      WHERE a.project_id = $1 AND a.status NOT IN ('Closed', 'Cancelled')`,
    [projectId]
  );

  const byRole = new Map<string, typeof actions.rows>();
  for (const a of actions.rows) {
    if (!byRole.has(a.owner_role)) byRole.set(a.owner_role, []);
    byRole.get(a.owner_role)!.push(a);
  }

  const out: DepartmentRow[] = [];
  for (const [owner_role, rows] of byRole) {
    const now = Date.now();
    const overdue = rows.filter((r) => r.due_at && Date.parse(r.due_at) < now).length;
    const breached = rows.filter((r) => r.outcome === "LATE").length;
    const ages = rows.map((r) => (now - Date.parse(r.created_at)) / 86400000);
    const blockerCounts = new Map<string, number>();
    for (const r of rows) {
      if (r.status === "Blocked" && r.blocking_reason) blockerCounts.set(r.blocking_reason, (blockerCounts.get(r.blocking_reason) ?? 0) + 1);
    }
    const top_blockers = [...blockerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count }));
    out.push({ owner_role, open_count: rows.length, on_track: rows.length - overdue - breached, overdue, breached, median_age_days: median(ages), top_blockers });
  }
  return out.sort((a, b) => b.open_count - a.open_count);
}
