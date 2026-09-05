import { describe, it, expect } from "vitest";
import { isWorkingDay, addWorkingDays, type CalendarRow } from "./calendar";

const MON_FRI: CalendarRow = { working_days: [1, 2, 3, 4, 5], holidays: [] };

describe("journey/calendar", () => {
  it("isWorkingDay respects the working-days list", () => {
    expect(isWorkingDay("2026-09-07", MON_FRI)).toBe(true); // Monday
    expect(isWorkingDay("2026-09-05", MON_FRI)).toBe(false); // Saturday
    expect(isWorkingDay("2026-09-06", MON_FRI)).toBe(false); // Sunday
  });

  it("isWorkingDay excludes holidays even on a working weekday", () => {
    const cal: CalendarRow = { working_days: [1, 2, 3, 4, 5], holidays: ["2026-09-07"] };
    expect(isWorkingDay("2026-09-07", cal)).toBe(false);
  });

  it("addWorkingDays skips weekends", () => {
    // Friday 2026-09-04 + 1 working day = Monday 2026-09-07
    expect(addWorkingDays("2026-09-04", 1, MON_FRI)).toBe("2026-09-07");
  });

  it("addWorkingDays skips holidays too", () => {
    const cal: CalendarRow = { working_days: [1, 2, 3, 4, 5], holidays: ["2026-09-08"] };
    // Monday 2026-09-07 + 1 working day, but Tuesday 09-08 is a holiday → Wednesday 09-09
    expect(addWorkingDays("2026-09-07", 1, cal)).toBe("2026-09-09");
  });

  it("addWorkingDays of 0 returns the start date unchanged", () => {
    expect(addWorkingDays("2026-09-07", 0, MON_FRI)).toBe("2026-09-07");
  });

  it("addWorkingDays across a full week", () => {
    // Monday 2026-09-07 + 5 working days = next Monday 2026-09-14
    expect(addWorkingDays("2026-09-07", 5, MON_FRI)).toBe("2026-09-14");
  });
});
