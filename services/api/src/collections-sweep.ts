import { withTx, type DbLike } from "./events";
import { createAction } from "./actions/core";
import { addWorkingDays, type CalendarRow } from "./journey/calendar";
import { today } from "./demands";

// Rule 2, first half (19-collections-true-risk.md): "Every OVERDUE demand must carry a
// reason_code within 2 working days; missing -> action 'Record overdue reason' for the RM/
// Accounts owner." No scheduler/cron exists anywhere in this codebase (same gap already flagged
// for 06's rule 1 ON_DATE_OFFSET triggers and rule 5's pre-breach ladder) — this is the logic a
// real nightly job would call. Nothing invokes it automatically today; it's callable directly
// (a future admin endpoint or cron adapter) and exercised by tests with a controlled `asOf`.
//
// "Overdue" here is derived from real facts (due_date < asOf, an open balance, not settled/
// waived/disputed) rather than trusting the stored `demand.status` text — the same read-time
// derivation collections.ts's classifyOpenAmount already relies on, so a demand that went overdue
// by date without ever having its status column flipped (nothing flips it outside seed data) is
// still caught.

const GRACE_WORKING_DAYS = 2; // the spec's own literal (rule 2) — not invented, but not yet a Policy Studio tab either

async function requireDefaultCalendar(tx: DbLike): Promise<CalendarRow> {
  // Same "one seeded Mon-Fri calendar, no per-project selection yet" precedent as
  // journey/instances.ts's own `ORDER BY id LIMIT 1` — real project-calendar selection is
  // out of scope for both features until more than one calendar exists to choose between.
  const r = await tx.query<CalendarRow>(`SELECT working_days, holidays FROM project_calendar ORDER BY id LIMIT 1`);
  if (!r.rows[0]) throw new Error("no project_calendar configured");
  return r.rows[0];
}

export interface OverdueReasonReminder {
  demand_id: string;
  action_id: string;
}

export async function sweepOverdueDemands(asOf: string = today(), tx?: DbLike): Promise<OverdueReasonReminder[]> {
  return withTx(tx, async (t) => {
    const calendar = await requireDefaultCalendar(t);
    const rows = await t.query<{ id: string; booking_id: string; project_id: string; due_date: string; milestone_label: string }>(
      `SELECT d.id, d.booking_id, d.project_id, d.due_date::text AS due_date, d.milestone_label
         FROM demand d
        WHERE d.due_date IS NOT NULL AND d.overdue_reason_code IS NULL
          AND d.status NOT IN ('settled', 'waived', 'disputed')
          AND (d.amount - COALESCE((
                SELECT SUM(r.amount) FROM receipt r
                 WHERE r.demand_id = d.id AND r.status IN ('posted','reconciled') AND r.verification != 'DISPUTED'
              ), 0) - COALESCE((
                SELECT SUM(w.amount) FROM waiver w
                 WHERE w.demand_id = d.id AND w.status = 'APPROVED'
              ), 0)) > 0`
    );

    const created: OverdueReasonReminder[] = [];
    for (const d of rows.rows) {
      const graceEnds = addWorkingDays(d.due_date, GRACE_WORKING_DAYS, calendar);
      if (asOf < graceEnds) continue; // still inside the grace window, not overdue-a-reason yet

      // Keyed on this reminder's own title, not just source_entity_id/type — setOverdueReason's
      // default-follow-up action shares the same source_entity_type/id and type ('exec_simple'),
      // so a bare match would go silent for this demand once a reason is later cleared and its
      // (still-open) follow-up action remains, without a "Record overdue reason" of its own.
      const title = `Record overdue reason — ${d.milestone_label}`;
      const already = await t.query(
        `SELECT 1 FROM action
          WHERE source_entity_type = 'demand' AND source_entity_id = $1
            AND title = $2 AND status NOT IN ('Closed', 'Cancelled')`,
        [d.id, title]
      );
      if (already.rows.length > 0) continue; // don't spam a second reminder while one is still open

      const actionId = await createAction(
        {
          type: "exec_simple",
          title,
          project_id: d.project_id,
          source_module: "collections",
          source_entity_type: "demand",
          source_entity_id: d.id,
          booking_id: d.booking_id,
          owner_role: "ACCOUNTS",
          priority: "HIGH",
          origin: "AUTO",
        },
        t
      );
      created.push({ demand_id: d.id, action_id: actionId });
    }
    return created;
  });
}

/** Convenience wrapper for a future cron adapter / admin route — omits `tx` so `sweepOverdueDemands`
 *  opens its own real transaction (passing the module-level `db` as `tx` here would short-circuit
 *  withTx's own `db.transaction()`/AsyncLocalStorage setup and silently suppress event dispatch). */
export async function runOverdueReasonSweep(asOf?: string): Promise<OverdueReasonReminder[]> {
  return sweepOverdueDemands(asOf);
}
