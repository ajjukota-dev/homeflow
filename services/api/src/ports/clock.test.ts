import { describe, expect, it } from "vitest";
import { createClock } from "./clock";

// 03-platform-deploy.md: "today" is the IST calendar day, never the UTC
// one — a request arriving between 00:00 and 05:30 IST is a different
// calendar day in UTC, and the old `today()` got this wrong.

describe("clock port", () => {
  it("todayIst() rolls over to the next day before UTC midnight", () => {
    // 2026-01-01T19:00:00Z = 2026-01-02T00:30:00+05:30
    const clock = createClock(() => new Date("2026-01-01T19:00:00Z"));
    expect(clock.todayIst()).toBe("2026-01-02");
  });

  it("todayIst() agrees with the UTC date well inside the IST day", () => {
    // 2026-01-01T10:00:00Z = 2026-01-01T15:30:00+05:30
    const clock = createClock(() => new Date("2026-01-01T10:00:00Z"));
    expect(clock.todayIst()).toBe("2026-01-01");
  });

  it("nowIst() is offset +5:30 from the injected instant", () => {
    const clock = createClock(() => new Date("2026-01-01T10:00:00Z"));
    expect(clock.nowIst().toISOString()).toBe("2026-01-01T15:30:00.000Z");
  });

  it("defaults to the real clock when no instant is injected", () => {
    const clock = createClock();
    expect(clock.todayIst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
