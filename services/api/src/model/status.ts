// Canonical status vocabulary (04 §Data, rule 3) in the spec's SCREAMING_SNAKE form.
//
// Decision: the DB keeps its existing lowercase values for booking.status and
// unit.sale_status. Renaming them would touch ~12 files (bookings.ts, demands-schedule.ts,
// legal-docs.ts, qa.ts, tower-view.ts, customer.ts, warranty.ts, collections-view.ts,
// legal-docs-source.ts, and 5+ test files) including several bare `WHERE status = 'active'`
// SQL string filters — a typo there fails silently (0 rows), not at compile time.
// 17 (sales-crm-handover) examined this directly: its own rule 5 literally says
// `booking.status = CRM_ACCEPTED`, but routing accept through the (already-legal, per 0003's
// CHECK constraint) unused 'crm_accepted' value would silently zero out the five non-test
// `WHERE status = 'active'` read sites above with no invented follow-on trigger for
// crm_accepted -> active anywhere in the spec set. 17 deliberately declined the rename — its
// own `sales_handover.status` (DRAFT/SUBMITTED/RETURNED/ACCEPTED) is the real signal for that
// feature; booking.status is untouched. New code (confirm/cancel/transfer, this file's
// transition graph, the Admin screens) speaks the spec vocabulary and translates at this one
// boundary. Flagged in the PR body and TODO.

export const BOOKING_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "SUBMITTED_TO_CRM",
  "RETURNED",
  "CRM_ACCEPTED",
  "ACTIVE",
  "REGISTERED",
  "HANDED_OVER",
  "CANCELLED",
  "TRANSFERRED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const DB_TO_SPEC_BOOKING: Record<string, BookingStatus> = {
  draft: "DRAFT",
  confirmed: "CONFIRMED",
  submitted: "SUBMITTED_TO_CRM",
  returned: "RETURNED",
  crm_accepted: "CRM_ACCEPTED",
  active: "ACTIVE",
  registered: "REGISTERED",
  handed_over: "HANDED_OVER",
  cancelled: "CANCELLED",
  transferred: "TRANSFERRED",
};
const SPEC_TO_DB_BOOKING = Object.fromEntries(
  Object.entries(DB_TO_SPEC_BOOKING).map(([db, spec]) => [spec, db])
) as Record<BookingStatus, string>;

export function toSpecBookingStatus(dbValue: string): BookingStatus {
  return DB_TO_SPEC_BOOKING[dbValue] ?? (dbValue.toUpperCase() as BookingStatus);
}
export function toDbBookingStatus(spec: BookingStatus): string {
  return SPEC_TO_DB_BOOKING[spec] ?? spec.toLowerCase();
}

// 04 rule 3 — the exact transition graph. CANCELLED reachable from any non-terminal state;
// TRANSFERRED only from ACTIVE/REGISTERED (creates a successor booking).
const TERMINAL: BookingStatus[] = ["HANDED_OVER", "CANCELLED", "TRANSFERRED"];
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SUBMITTED_TO_CRM", "CANCELLED"],
  SUBMITTED_TO_CRM: ["RETURNED", "CRM_ACCEPTED", "CANCELLED"],
  RETURNED: ["SUBMITTED_TO_CRM", "CANCELLED"],
  CRM_ACCEPTED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["REGISTERED", "CANCELLED", "TRANSFERRED"],
  REGISTERED: ["HANDED_OVER", "CANCELLED", "TRANSFERRED"],
  HANDED_OVER: [],
  CANCELLED: [],
  TRANSFERRED: [],
};

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return TERMINAL.includes(status);
}

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!BOOKING_TRANSITIONS[from]?.includes(to)) {
    const err = new Error(`invalid_transition`) as Error & { code: string; from: string; to: string };
    err.code = "validation";
    err.from = from;
    err.to = to;
    throw err;
  }
}

// Unit sale_status (04 §Data) — same DB-keeps-lowercase decision as booking.status above.
export const UNIT_SALE_STATUSES = [
  "AVAILABLE",
  "HELD",
  "BOOKED",
  "REGISTERED",
  "HANDED_OVER",
  "CANCELLED_RELEASE",
] as const;
export type UnitSaleStatus = (typeof UNIT_SALE_STATUSES)[number];

const DB_TO_SPEC_UNIT: Record<string, UnitSaleStatus> = {
  available: "AVAILABLE",
  held: "HELD",
  booked: "BOOKED",
  registered: "REGISTERED",
  handed_over: "HANDED_OVER",
  cancelled_release: "CANCELLED_RELEASE",
};
export function toSpecUnitSaleStatus(dbValue: string): UnitSaleStatus {
  return DB_TO_SPEC_UNIT[dbValue] ?? (dbValue.toUpperCase() as UnitSaleStatus);
}
