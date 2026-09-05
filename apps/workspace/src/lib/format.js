/**
 * Indian numbering: 1,00,000 for 1 lakh; 1,00,00,000 for 1 crore.
 * Compact for large amounts: ₹4.75 Cr, ₹42.50 L; full formatted for smaller.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatINR(value, opts = {}) {
  const { compact = true, prefix = "₹" } = opts;
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const n = Math.round(Number(value));
  const abs = Math.abs(n);

  if (compact) {
    if (abs >= 10_000_000) {
      // Crore
      const cr = n / 10_000_000;
      return `${prefix}${trim(cr, 2)} Cr`;
    }
    if (abs >= 100_000) {
      const lakh = n / 100_000;
      return `${prefix}${trim(lakh, 2)} L`;
    }
  }
  return `${prefix}${formatIndianDigits(n)}`;
}

export function formatINRFull(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const n = Math.round(Number(value));
  return `₹${formatIndianDigits(n)}`;
}

function trim(v, digits) {
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, "");
}

function formatIndianDigits(n) {
  const sign = n < 0 ? "-" : "";
  const s = String(Math.abs(n));
  if (s.length <= 3) return sign + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const withCommas = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return sign + withCommas + "," + last3;
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()];
  const yr = d.getFullYear();
  return `${day} ${mon} ${yr}`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()];
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${yr}, ${hh}:${mm}`;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
