/**
 * Indian numbering and IST dates — ported from v1's `src/lib/format.js`
 * (foundation/v1-reuse.md §1: keep the formatting, type it).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const CRORE = 10_000_000;
const LAKH = 100_000;

function trim(v: number, digits: number): string {
  return v.toFixed(digits).replace(/\.?0+$/, "");
}

/** 1,00,000 for a lakh; 1,00,00,000 for a crore. */
export function indianDigits(n: number): string {
  const sign = n < 0 ? "-" : "";
  const s = String(Math.abs(n));
  if (s.length <= 3) return sign + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return sign + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

/** `₹4.75 Cr`, `₹42.5 L`, `₹9,500`. `compact: false` never abbreviates. */
export function inr(value: number | string | null | undefined, opts: { compact?: boolean; prefix?: string } = {}): string {
  const { compact = true, prefix = "₹" } = opts;
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const n = Math.round(Number(value));
  const abs = Math.abs(n);
  if (compact && abs >= CRORE) return `${prefix}${trim(n / CRORE, 2)} Cr`;
  if (compact && abs >= LAKH) return `${prefix}${trim(n / LAKH, 2)} L`;
  return `${prefix}${indianDigits(n)}`;
}

export const inrFull = (value: number | string | null | undefined): string => inr(value, { compact: false });

const IST_OFFSET_MIN = 5 * 60 + 30;

function toIst(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + (IST_OFFSET_MIN + d.getTimezoneOffset()) * 60_000);
}

/** `04 Sep 2026` in IST. */
export function date(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = toIst(value);
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `04 Sep 2026, 18:30 IST`. */
export function dateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = toIst(value);
  if (!d) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date(value)}, ${hh}:${mm} IST`;
}

/** `in 3 days`, `2 hours ago`, `just now`. */
export function relativeTime(value: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (value == null || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const secs = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(secs);
  if (abs < 45) return "just now";
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86_400, "hour"],
    [2_592_000, "day"],
    [31_536_000, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  const divisors = [1, 60, 3600, 86_400, 2_592_000, 31_536_000];
  for (let i = 0; i < units.length; i += 1) {
    if (abs < units[i][0]) {
      const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
      return rtf.format(Math.round(secs / divisors[i]), units[i][1]);
    }
  }
  return date(value);
}
