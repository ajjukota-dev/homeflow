// 00-conventions.md: "today" is the IST calendar day, never new Date().toISOString().slice(0,10).
// TODO.md §9 flags demands.ts's today() as UTC-only; this is the one IST-correct
// helper for identity's effective-dating checks (permission_matrix, assignments).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The IST calendar day before `now` — for closing an effective-dated row's `effective_to`. */
export function yesterdayIst(now: Date = new Date()): string {
  return todayIst(new Date(now.getTime() - ONE_DAY_MS));
}

/** IST wall-clock "HH:MM". Same shift as todayIst — tests inject `now` rather than sleeping. */
export function nowIstHm(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Inclusive start, exclusive end; wrap-safe (21:00–08:00 crosses midnight). start===end → never quiet. */
export function isWithinQuietHours(nowHm: string, start: string, end: string): boolean {
  if (start === end) return false;
  if (start < end) return nowHm >= start && nowHm < end;
  return nowHm >= start || nowHm < end;
}
