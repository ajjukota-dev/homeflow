// Rule 1: 5 failures per email per 15 min → 429 rate_limited [ours]. In-memory —
// fine for one API process; would move to Postgres/Redis behind a shared port
// if the API ever scales past one instance.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, number[]>();

export function isRateLimited(email: string, now = Date.now()): boolean {
  const attempts = (failures.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(email, attempts);
  return attempts.length >= MAX_FAILURES;
}

export function recordFailure(email: string, now = Date.now()): void {
  const attempts = (failures.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.push(now);
  failures.set(email, attempts);
}

export function clearFailures(email: string): void {
  failures.delete(email);
}

/** Test-only: the module-level Map otherwise leaks failure counts across test files. */
export function resetRateLimitStoreForTests(): void {
  failures.clear();
}
