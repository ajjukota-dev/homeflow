// Rule 11 (19-collections-true-risk.md): "All money math in integer paise internally or
// numeric — never JS float arithmetic on rupees." Postgres `numeric` columns already give exact
// decimal storage/arithmetic for existing demand/receipt amounts (unchanged, legacy, out of scope
// here — a full rewrite of already-tested code for no reported bug isn't this feature's job).
// This module is for the NEW rupee math this feature introduces (TDS %, waiver amounts, clearance
// paid-percent, statement running balances): every multiply/divide that could produce a fraction
// of a rupee is done in integer paise, then converted back, so rounding is explicit and tested —
// not whatever IEEE-754 happens to give a `x * 0.01` in JS.

/** Rupees (number or numeric-string, as read from Postgres) -> integer paise. Throws on a
 *  non-finite input rather than silently producing NaN paise. */
export function rupeesToPaise(rupees: number | string): number {
  const n = typeof rupees === "string" ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error(`rupeesToPaise: not a finite number: ${rupees}`);
  return Math.round(n * 100);
}

/** Integer paise -> rupees, rounded to the nearest paise (2 decimal places). */
export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) throw new Error(`paiseToRupees: not an integer paise value: ${paise}`);
  return paise / 100;
}

/** Sum rupee amounts by converting to integer paise first, so no intermediate float drift. */
export function sumRupees(amounts: (number | string)[]): number {
  const totalPaise = amounts.reduce<number>((sum, a) => sum + rupeesToPaise(a), 0);
  return paiseToRupees(totalPaise);
}

/** rupees * pct (e.g. 1% TDS = pct 1) computed in integer paise, rounded to the nearest paise. */
export function applyPercent(rupees: number | string, pct: number): number {
  const paise = rupeesToPaise(rupees);
  return paiseToRupees(Math.round((paise * pct) / 100));
}

/** paid / total as a fraction in [0, 1] (or 0 if total is not positive) — for clearance
 *  threshold checks (rule 9) and true-risk-style percent math. Computed from paise so the
 *  comparison against a threshold_pct is exact, not float-noisy. */
export function paidFraction(paidRupees: number | string, totalRupees: number | string): number {
  const totalPaise = rupeesToPaise(totalRupees);
  if (totalPaise <= 0) return 0;
  return rupeesToPaise(paidRupees) / totalPaise;
}

/** ₹ with Indian digit grouping (1,20,00,000 not 12,000,000) — no currency symbol, callers
 *  prefix ₹ themselves so this stays reusable in contexts (SMS, logs) that don't want it. */
export function formatIndianGrouping(rupees: number | string): string {
  const n = typeof rupees === "string" ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error(`formatIndianGrouping: not a finite number: ${rupees}`);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
