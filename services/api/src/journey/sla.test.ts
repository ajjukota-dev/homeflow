import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { withTx } from "../events";
import { startClock, pauseClock, resumeClock, stopClock } from "./sla";
import type { CalendarRow } from "./calendar";

beforeAll(async () => {
  await initDb();
});

const MON_FRI: CalendarRow = { working_days: [1, 2, 3, 4, 5], holidays: [] };

async function makePolicy(id: string, duration_value: number, duration_unit: "WORKING_DAYS" | "CALENDAR_DAYS" | "HOURS") {
  await db.query(
    `INSERT INTO sla_policy (id, code, applies_to, target_ref, duration_value, duration_unit, effective_from)
     VALUES ($1,$1,'TASK_CODE','T1',$2,$3,'2020-01-01')`,
    [id, duration_value, duration_unit]
  );
  return { id, duration_value, duration_unit };
}

describe("journey/sla: clock lifecycle (rule 5)", () => {
  it("startClock computes due_at from a CALENDAR_DAYS policy", async () => {
    const policy = await makePolicy("pol_cal_3", 3, "CALENDAR_DAYS");
    const startAt = new Date("2026-09-10T10:00:00Z");
    const clockId = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t1", policy, calendar: MON_FRI, startAt }, tx));
    const c = await db.query<{ due_at: string }>(`SELECT due_at FROM sla_clock WHERE id = $1`, [clockId]);
    expect(new Date(c.rows[0].due_at).toISOString()).toBe("2026-09-13T10:00:00.000Z");
  });

  it("startClock computes due_at from a WORKING_DAYS policy, skipping weekends", async () => {
    const policy = await makePolicy("pol_wd_1", 1, "WORKING_DAYS");
    // Friday → next working day is Monday.
    const startAt = new Date("2026-09-04T05:00:00Z");
    const clockId = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t2", policy, calendar: MON_FRI, startAt }, tx));
    const c = await db.query<{ due_at: string }>(`SELECT due_at FROM sla_clock WHERE id = $1`, [clockId]);
    // 00:00 IST Monday 2026-09-07 = 18:30 UTC Sunday 2026-09-06 — assert the exact instant, not
    // a UTC-sliced date (that's exactly the UTC/IST day-boundary bug rule 10 exists to avoid).
    expect(new Date(c.rows[0].due_at).toISOString()).toBe("2026-09-06T18:30:00.000Z");
  });

  it("startClock computes due_at from an HOURS policy", async () => {
    const policy = await makePolicy("pol_hrs_4", 4, "HOURS");
    const startAt = new Date("2026-09-10T10:00:00Z");
    const clockId = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t3", policy, calendar: MON_FRI, startAt }, tx));
    const c = await db.query<{ due_at: string }>(`SELECT due_at FROM sla_clock WHERE id = $1`, [clockId]);
    expect(new Date(c.rows[0].due_at).toISOString()).toBe("2026-09-10T14:00:00.000Z");
  });

  it("pause shifts due_at forward by the paused duration on resume", async () => {
    const policy = await makePolicy("pol_pause_1", 24, "HOURS");
    const clockId = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t4", policy, calendar: MON_FRI }, tx));
    const before = await db.query<{ due_at: string }>(`SELECT due_at FROM sla_clock WHERE id = $1`, [clockId]);

    await withTx(undefined, (tx) => pauseClock(clockId, "WAITING_CUSTOMER", tx));
    const paused = await db.query<{ paused_at: string | null }>(`SELECT paused_at FROM sla_clock WHERE id = $1`, [clockId]);
    expect(paused.rows[0].paused_at).not.toBeNull();

    // Back-date paused_at by 5 real seconds instead of faking the clock — PGlite's own now()
    // isn't affected by vi.useFakeTimers (it's a separate in-process SQL engine), so this is
    // the only deterministic way to force a known elapsed-pause duration.
    await db.query(`UPDATE sla_clock SET paused_at = paused_at - interval '5 seconds' WHERE id = $1`, [clockId]);
    await withTx(undefined, (tx) => resumeClock(clockId, tx));

    const after = await db.query<{ due_at: string; paused_at: string | null; total_paused_seconds: number }>(
      `SELECT due_at, paused_at, total_paused_seconds FROM sla_clock WHERE id = $1`,
      [clockId]
    );
    expect(after.rows[0].paused_at).toBeNull();
    expect(after.rows[0].total_paused_seconds).toBeGreaterThanOrEqual(5);
    expect(new Date(after.rows[0].due_at).getTime()).toBeGreaterThan(new Date(before.rows[0].due_at).getTime());
  });

  it("pause/resume are idempotent (no-op if already in that state)", async () => {
    const policy = await makePolicy("pol_idem_1", 24, "HOURS");
    const clockId = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t5", policy, calendar: MON_FRI }, tx));
    await expect(withTx(undefined, (tx) => resumeClock(clockId, tx))).resolves.not.toThrow(); // not paused yet
    await withTx(undefined, (tx) => pauseClock(clockId, "WAITING_CUSTOMER", tx));
    await expect(withTx(undefined, (tx) => pauseClock(clockId, "WAITING_CUSTOMER", tx))).resolves.not.toThrow(); // already paused
  });

  it("stopClock marks ON_TIME when stopped before due_at, LATE after", async () => {
    const onTimePolicy = await makePolicy("pol_stop_ontime", 100, "HOURS");
    const onTimeClock = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t6", policy: onTimePolicy, calendar: MON_FRI }, tx));
    const outcome1 = await withTx(undefined, (tx) => stopClock(onTimeClock, tx));
    expect(outcome1).toBe("ON_TIME");

    const latePolicy = await makePolicy("pol_stop_late", 1, "HOURS");
    const startAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // started 2h ago, due 1h after that
    const lateClock = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t7", policy: latePolicy, calendar: MON_FRI, startAt }, tx));
    const outcome2 = await withTx(undefined, (tx) => stopClock(lateClock, tx));
    expect(outcome2).toBe("LATE");
  });

  it("cannot pause or stop a clock that's already stopped", async () => {
    const policy = await makePolicy("pol_double_stop", 24, "HOURS");
    const clockId = await withTx(undefined, (tx) => startClock({ subject_type: "task_instance", subject_id: "t8", policy, calendar: MON_FRI }, tx));
    await withTx(undefined, (tx) => stopClock(clockId, tx));
    await expect(withTx(undefined, (tx) => stopClock(clockId, tx))).rejects.toThrow(/already stopped/);
    await expect(withTx(undefined, (tx) => pauseClock(clockId, "x", tx))).rejects.toThrow(/stopped/);
  });
});
