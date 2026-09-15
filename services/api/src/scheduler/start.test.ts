import { describe, it, expect, vi, afterEach } from "vitest";
import { schedulerEnabled, schedulerIntervalMs, startScheduler } from "./start";

// e31-tests: Vitest never starts setInterval. Jobs stay functions with injected asOf.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("e31-tests — scheduler stays off in vitest", () => {
  it("importing the scheduler module does not start an interval", async () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    await import("./start");
    await import("./jobs");
    expect(spy).not.toHaveBeenCalled();
  });

  it("startScheduler is a no-op when VITEST is set", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    expect(startScheduler()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("schedulerEnabled is false in test / when HOMEFLOW_SCHEDULER is 0 or false", () => {
    expect(schedulerEnabled({ VITEST: "true" })).toBe(false);
    expect(schedulerEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(schedulerEnabled({ HOMEFLOW_SCHEDULER: "0" })).toBe(false);
    expect(schedulerEnabled({ HOMEFLOW_SCHEDULER: "false" })).toBe(false);
    expect(schedulerEnabled({ HOMEFLOW_SCHEDULER: "FALSE" })).toBe(false);
    expect(schedulerEnabled({})).toBe(true);
  });

  it("HOMEFLOW_SCHEDULER_MS defaults to 60s and accepts a named override", () => {
    expect(schedulerIntervalMs({})).toBe(60_000);
    expect(schedulerIntervalMs({ HOMEFLOW_SCHEDULER_MS: "300000" })).toBe(300_000);
  });
});
