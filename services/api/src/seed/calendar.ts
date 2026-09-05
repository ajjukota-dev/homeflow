import type { DbClient } from "../db/types";

// Default project calendar (06-timeline-sla-engine.md `project_calendar`) — config in every
// environment. Mon-Fri working days, no holidays yet (public holiday dates are real,
// knowable facts, not invented — but a specific year's list needs Amarsh's confirmation
// before it's seeded here rather than guessed). Single shared calendar for now: `project`
// has no per-project calendar_id column yet — every journey uses this one until a real
// second calendar is needed (deliberate scope cut, logged in TODO.md).
export const DEFAULT_CALENDAR_ID = "cal_default";

export async function seedDefaultCalendar(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM project_calendar WHERE id = $1`,
    [DEFAULT_CALENDAR_ID]
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  await db.query(
    `INSERT INTO project_calendar (id, name, working_days, holidays, timezone)
     VALUES ($1,'Default (Mon-Fri, no holidays)','[1,2,3,4,5]'::jsonb,'[]'::jsonb,'Asia/Kolkata')`,
    [DEFAULT_CALENDAR_ID]
  );
}
