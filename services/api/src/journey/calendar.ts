// Pure working-day math for journey scheduling (06-timeline-sla-engine.md rule 2/10).
// Operates on plain YYYY-MM-DD date strings, never a raw JS Date + UTC offset arithmetic
// (rule 10's regression: 00:30 IST and 23:30 IST must give the same calendar day) — the
// project's own `clock` port (ports/clock.ts) already resolves "now" to an IST day string;
// this module only walks forward from a given day, so it never touches wall-clock time itself.

/** A `date` column comes back as either a string or a Date object depending on adapter
 *  (same quirk `demands.ts`'s own `asDate` works around) — normalize to YYYY-MM-DD. */
export function asDateStr(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export interface CalendarRow {
  working_days: number[]; // 0=Sun..6=Sat
  holidays: string[]; // YYYY-MM-DD
}

export function isWorkingDay(dateStr: string, calendar: CalendarRow): boolean {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return calendar.working_days.includes(dow) && !calendar.holidays.includes(dateStr);
}

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Walks forward `count` working days from `startDateStr` (exclusive of the start day itself). */
export function addWorkingDays(startDateStr: string, count: number, calendar: CalendarRow): string {
  let d = startDateStr;
  let remaining = count;
  while (remaining > 0) {
    d = addCalendarDays(d, 1);
    if (isWorkingDay(d, calendar)) remaining--;
  }
  return d;
}
