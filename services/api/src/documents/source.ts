import { db } from "../db";
import type { DbLike } from "../events";

// 22 merge-field resolution: a live context built from booking/unit/project/customer/applicants,
// walked by `merge_field_definition.source_path` (e.g. "customer.primary_name", "applicant[0].pan",
// "unit.carpet_area_sqft"). `code` is the free-form placeholder name authors put in `{{code}}`
// template slots; `source_path` is where the value actually lives — kept separate per the spec's
// own table shape so Studio authors can name fields however reads best in a document.

export interface DocSourceContext {
  booking: Record<string, unknown>;
  unit: Record<string, unknown>;
  project: Record<string, unknown>;
  customer: Record<string, unknown>;
  applicant: Record<string, unknown>[];
}

export async function buildSourceContext(bookingId: string, tx: DbLike = db): Promise<DocSourceContext> {
  const b = await tx.query<{
    id: string; project_id: string; unit_id: string; booking_number: string; total_consideration: number; discount_inr: number | null;
    project_name: string; rera_reg_no: string | null; unit_code: string; unit_number: string; unit_type: string; product_type: string;
    carpet_area_sqft: number | null; built_up_area_sqft: number | null;
  }>(
    `SELECT b.id, b.project_id, b.unit_id, b.booking_number, b.total_consideration::float8 AS total_consideration, b.discount_inr::float8 AS discount_inr,
            p.name AS project_name, p.rera_reg_no,
            u.code AS unit_code, u.unit_number, u.unit_type, u.product_type, u.carpet_area_sqft::float8 AS carpet_area_sqft, u.built_up_area_sqft::float8 AS built_up_area_sqft
       FROM booking b JOIN unit u ON u.id = b.unit_id JOIN project p ON p.id = b.project_id
      WHERE b.id = $1`,
    [bookingId]
  );
  const row = b.rows[0];
  if (!row) throw new Error("booking_not_found");

  const applicants = await tx.query<{ display_name: string; pan: string | null; phone: string | null; role: string; residency: string | null; customer_id: string | null }>(
    `SELECT ba.display_name, ba.pan, ba.phone, ba.role, c.residency, ba.customer_id
       FROM booking_applicant ba LEFT JOIN customer c ON c.id = ba.customer_id
      WHERE ba.booking_id = $1 ORDER BY ba.sort_order`,
    [bookingId]
  );
  const primary = applicants.rows.find((a) => a.role === "primary") ?? applicants.rows[0];
  const customer = primary?.customer_id
    ? (await tx.query<Record<string, unknown>>(`SELECT code, primary_name, pan, aadhaar_last4, passport_no, oci_no, residency, address_line1, address_city, address_state, address_pincode FROM customer WHERE id = $1`, [primary.customer_id])).rows[0] ?? {}
    : {};

  return {
    booking: { id: row.id, code: row.booking_number, total_consideration: row.total_consideration, discount_inr: row.discount_inr },
    unit: { code: row.unit_code, number: row.unit_number, type: row.unit_type, product_type: row.product_type, carpet_area_sqft: row.carpet_area_sqft, built_up_area_sqft: row.built_up_area_sqft },
    project: { id: row.project_id, name: row.project_name, rera_reg_no: row.rera_reg_no },
    customer,
    applicant: applicants.rows.map((a) => ({ display_name: a.display_name, pan: a.pan, phone: a.phone, role: a.role, residency: a.residency })),
  };
}

/** Dot/bracket path walker: "unit.carpet_area_sqft", "applicant[0].pan". Returns undefined, not a throw, on a bad path. */
export function resolvePath(context: unknown, path: string): unknown {
  let cur: unknown = context;
  for (const seg of path.split(".")) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)(\[(\d+)\])?$/.exec(seg);
    if (!m || cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[m[1]!];
    if (m[3] !== undefined) cur = Array.isArray(cur) ? cur[Number(m[3])] : undefined;
  }
  return cur;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${h ? ONES[h] + " Hundred" + (rest ? " " : "") : ""}${rest ? twoDigits(rest) : ""}`;
}

/** Rule 9: full figures, no Cr/L abbreviations. Indian grouping (crore/lakh/thousand/hundred). */
export function moneyToIndianWords(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (n === 0) return "Zero Rupees Only";
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const hundred = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return `${parts.join(" ")} Rupees Only`.trim();
}

/** Rule 9: Indian digit grouping (₹1,20,00,000, not ₹1.2Cr). */
export function moneyToIndianFigures(amount: number): string {
  const n = Math.round(Math.abs(amount));
  const s = String(n);
  if (s.length <= 3) return `₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest.replace(/(\d)(?=(\d\d)+(?!\d))/g, "$1,");
  return `₹${grouped},${last3}`;
}

export function formatMergeValue(value: unknown, type: string, format: string | null): string {
  if (value === null || value === undefined) return "";
  if (type === "MONEY") {
    const n = Number(value);
    if (format === "WORDS") return moneyToIndianWords(n);
    return moneyToIndianFigures(n);
  }
  if (type === "DATE" && value) {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  return String(value);
}
