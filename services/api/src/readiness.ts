// Evidence-based unit readiness — qa/spec.md §1.3. Never a typed percentage.

export function readinessScore(
  components: { code: string; qa_verified: boolean }[],
  criticalOpen: number
): { value: number; drivers: string[] } {
  const total = components.length || 1;
  const verified = components.filter((c) => c.qa_verified).length;
  const base = Math.round((100 * verified) / total);
  const value = Math.max(0, base - 25 * criticalOpen);
  const drivers = [`${verified} of ${total} components independently verified by QA`];
  if (criticalOpen > 0) {
    drivers.push(`${criticalOpen} critical snag(s) open — each subtracts 25`);
  }
  return { value, drivers };
}
