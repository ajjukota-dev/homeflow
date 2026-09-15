import { runOnce } from "./jobs";

// Local demo clock — one setInterval, no node-cron. Off in vitest and when HOMEFLOW_SCHEDULER
// is "0"/"false". Cadence is HOMEFLOW_SCHEDULER_MS (default 60s), not a per-project hour.

type Env = Record<string, string | undefined>;

export function schedulerEnabled(env: Env = process.env): boolean {
  if (env.VITEST) return false;
  if (env.NODE_ENV === "test") return false;
  const flag = (env.HOMEFLOW_SCHEDULER ?? "").toLowerCase();
  if (flag === "0" || flag === "false") return false;
  return true;
}

export function schedulerIntervalMs(env: Env = process.env): number {
  const n = Number(env.HOMEFLOW_SCHEDULER_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/** Starts the interval after listen. Vitest never reaches setInterval. */
export function startScheduler(env: Env = process.env): ReturnType<typeof setInterval> | null {
  if (!schedulerEnabled(env)) return null;
  const tick = () => {
    void runOnce().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] runOnce failed: ${message}`);
    });
  };
  tick();
  return setInterval(tick, schedulerIntervalMs(env));
}
