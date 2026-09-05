import { randomUUID } from "node:crypto";
import type { DbLike } from "../events";
import type { CalendarRow } from "./calendar";
import { addWorkingDays } from "./calendar";

// SLA clock lifecycle (06-timeline-sla-engine.md rule 5). "SLA clocks start when a task
// becomes actionable ... not at journey start." Pause shifts `due_at` forward by the paused
// duration (so deriveStatus, engine.ts, only ever needs `now` vs `due_at` — total_paused_seconds
// is kept as an audit/reporting field, not re-derived from at read time).

export interface SlaPolicyRow {
  id: string;
  duration_value: number;
  duration_unit: "WORKING_DAYS" | "CALENDAR_DAYS" | "HOURS";
}

function computeDueAt(startAt: Date, policy: SlaPolicyRow, calendar: CalendarRow): Date {
  if (policy.duration_unit === "HOURS") {
    return new Date(startAt.getTime() + policy.duration_value * 60 * 60 * 1000);
  }
  if (policy.duration_unit === "CALENDAR_DAYS") {
    return new Date(startAt.getTime() + policy.duration_value * 24 * 60 * 60 * 1000);
  }
  // WORKING_DAYS: walk forward on the calendar from the start date, then anchor to IST midnight
  // (00:00 IST = 18:30 UTC the previous day) — SLAs here are day-granularity, not time-of-day.
  const startDate = startAt.toISOString().slice(0, 10);
  const dueDate = addWorkingDays(startDate, policy.duration_value, calendar);
  return new Date(`${dueDate}T00:00:00+05:30`);
}

async function logClockEvent(
  tx: DbLike,
  clockId: string,
  kind: "START" | "PAUSE" | "RESUME" | "STOP" | "RESET",
  reason: string | null
): Promise<void> {
  await tx.query(
    `INSERT INTO sla_clock_event (id, clock_id, kind, reason) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), clockId, kind, reason]
  );
}

export async function startClock(
  input: { subject_type: string; subject_id: string; policy: SlaPolicyRow; calendar: CalendarRow; startAt?: Date },
  tx: DbLike
): Promise<string> {
  const startAt = input.startAt ?? new Date();
  const dueAt = computeDueAt(startAt, input.policy, input.calendar);
  const id = "clk_" + randomUUID().slice(0, 8);
  await tx.query(
    `INSERT INTO sla_clock (id, subject_type, subject_id, policy_id, started_at, due_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, input.subject_type, input.subject_id, input.policy.id, startAt.toISOString(), dueAt.toISOString()]
  );
  await logClockEvent(tx, id, "START", null);
  return id;
}

export async function pauseClock(clockId: string, reason: string, tx: DbLike): Promise<void> {
  const c = await tx.query<{ paused_at: string | null; stopped_at: string | null }>(
    `SELECT paused_at, stopped_at FROM sla_clock WHERE id = $1`,
    [clockId]
  );
  if (c.rows.length === 0) throw new Error("sla_clock not found");
  if (c.rows[0].stopped_at) throw new Error("cannot pause a stopped clock");
  if (c.rows[0].paused_at) return; // already paused — idempotent
  await tx.query(`UPDATE sla_clock SET paused_at = now(), paused_reason = $2 WHERE id = $1`, [clockId, reason]);
  await logClockEvent(tx, clockId, "PAUSE", reason);
}

export async function resumeClock(clockId: string, tx: DbLike): Promise<void> {
  const c = await tx.query<{ paused_at: string | null; due_at: string; total_paused_seconds: number }>(
    `SELECT paused_at, due_at, total_paused_seconds FROM sla_clock WHERE id = $1`,
    [clockId]
  );
  if (c.rows.length === 0) throw new Error("sla_clock not found");
  if (!c.rows[0].paused_at) return; // not paused — idempotent
  const pausedSeconds = Math.round((Date.now() - new Date(c.rows[0].paused_at).getTime()) / 1000);
  const newDueAt = new Date(new Date(c.rows[0].due_at).getTime() + pausedSeconds * 1000);
  await tx.query(
    `UPDATE sla_clock
        SET paused_at = NULL, paused_reason = NULL,
            total_paused_seconds = total_paused_seconds + $2, due_at = $3
      WHERE id = $1`,
    [clockId, pausedSeconds, newDueAt.toISOString()]
  );
  await logClockEvent(tx, clockId, "RESUME", null);
}

export async function stopClock(clockId: string, tx: DbLike): Promise<"ON_TIME" | "LATE"> {
  const c = await tx.query<{ due_at: string; stopped_at: string | null }>(
    `SELECT due_at, stopped_at FROM sla_clock WHERE id = $1`,
    [clockId]
  );
  if (c.rows.length === 0) throw new Error("sla_clock not found");
  if (c.rows[0].stopped_at) throw new Error("clock already stopped");
  const now = new Date();
  const outcome: "ON_TIME" | "LATE" = now.getTime() > new Date(c.rows[0].due_at).getTime() ? "LATE" : "ON_TIME";
  await tx.query(`UPDATE sla_clock SET stopped_at = $2, outcome = $3 WHERE id = $1`, [clockId, now.toISOString(), outcome]);
  await logClockEvent(tx, clockId, "STOP", null);
  return outcome;
}
