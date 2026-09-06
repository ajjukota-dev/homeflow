// Pure, framework-free KPI arithmetic (27-management-control-tower.md rule 4). Kept separate
// from kpis/queries.ts's DB access per CLAUDE.md's "explicit boundaries" principle — every KPI's
// *shape* (a numerator/denominator ratio, an average, a sum) is one of these, unit-tested here in
// isolation; the query layer only assembles the raw facts.

export interface KpiResult {
  value: number | null; // null when denominator is 0 — an honest "no data yet", not a fake 0
  numerator: number;
  denominator: number;
}

export function percentOf(numerator: number, denominator: number): KpiResult {
  return { value: denominator > 0 ? (numerator / denominator) * 100 : null, numerator, denominator };
}

export function average(values: number[]): KpiResult {
  return { value: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null, numerator: values.reduce((a, b) => a + b, 0), denominator: values.length };
}

export function sum(values: number[]): KpiResult {
  const total = values.reduce((a, b) => a + b, 0);
  return { value: total, numerator: total, denominator: values.length };
}

export function ratePer(numerator: number, per: number, base: number): KpiResult {
  return { value: base > 0 ? (numerator / base) * per : null, numerator, denominator: base };
}

/** Rule 4's "forecast accuracy %" — 1 minus the relative error between what was forecast and
 *  what actually landed, clamped to [0, 100] (a forecast that was off by more than 100% reads as
 *  0% accurate, not a negative number nobody can interpret). */
export function forecastAccuracy(forecast: number, actual: number): KpiResult {
  if (actual === 0) return { value: null, numerator: forecast, denominator: actual };
  const error = Math.abs(forecast - actual) / Math.abs(actual);
  return { value: Math.max(0, 1 - error) * 100, numerator: forecast, denominator: actual };
}
