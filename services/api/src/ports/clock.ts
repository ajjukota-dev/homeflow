// clock port (03-platform-deploy.md): "today" is always the IST calendar
// day (p-conventions: "never new Date().toISOString().slice(0,10)"), and
// injectable so tests can pin a fixed instant instead of the real clock.

export interface Clock {
  nowIst(): Date;
  todayIst(): string; // YYYY-MM-DD
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function createClock(now: () => Date = () => new Date()): Clock {
  const shiftedToIst = () => new Date(now().getTime() + IST_OFFSET_MS);
  return {
    nowIst: shiftedToIst,
    todayIst: () => shiftedToIst().toISOString().slice(0, 10),
  };
}

// Default instance for call sites that don't (yet) receive ctx.clock.
export const clock: Clock = createClock();
