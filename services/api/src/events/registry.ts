// Event type registry — Appendix B taxonomy (p42) plus sanctioned extensions (02 §Appendix B
// "Extend with action.*, ..."). Seeded into `event_type` on boot. `built: true` marks a type
// with at least one real emitter + emission test in this codebase today; the registry-coverage
// test (registry.test.ts) only requires emitters for built=true rows, so an Appendix B name
// whose feature (commitments, escalations, loans, ...) isn't merged yet doesn't fail the suite —
// per 02 §Acceptance, that test starts failing "once its feature is built" and someone forgets.

export interface EventTypeDef {
  name: string;
  family: string;
  customer_visible: boolean;
  built: boolean;
}

export const EVENT_TYPES: EventTypeDef[] = [
  // --- Appendix B verbatim (p42) ---
  { name: "booking.created", family: "booking", customer_visible: false, built: true },
  { name: "sales_handover.submitted", family: "sales_handover", customer_visible: false, built: true },
  { name: "sales_handover.returned", family: "sales_handover", customer_visible: false, built: true },
  { name: "sales_handover.accepted", family: "sales_handover", customer_visible: false, built: true },
  { name: "document.requested", family: "document", customer_visible: false, built: false },
  { name: "document.received", family: "document", customer_visible: false, built: false },
  { name: "document.validated", family: "document", customer_visible: false, built: false },
  { name: "document.rejected", family: "document", customer_visible: false, built: false },
  { name: "demand.raised", family: "demand", customer_visible: true, built: true },
  { name: "payment.received", family: "payment", customer_visible: true, built: true },
  { name: "payment.reconciled", family: "payment", customer_visible: true, built: true },
  { name: "loan.sanction_received", family: "loan", customer_visible: false, built: false },
  { name: "loan.disbursement_received", family: "loan", customer_visible: false, built: false },
  { name: "agreement.generated", family: "agreement", customer_visible: false, built: true },
  { name: "agreement.executed", family: "agreement", customer_visible: true, built: true },
  { name: "registration.scheduled", family: "registration", customer_visible: true, built: false },
  { name: "registration.completed", family: "registration", customer_visible: true, built: true },
  { name: "progress.updated", family: "progress", customer_visible: false, built: true },
  { name: "qa.inspection_passed", family: "qa", customer_visible: false, built: true },
  { name: "qa.inspection_failed", family: "qa", customer_visible: false, built: false },
  { name: "snag.opened", family: "snag", customer_visible: false, built: false },
  { name: "snag.closed", family: "snag", customer_visible: true, built: true },
  { name: "commitment.created", family: "commitment", customer_visible: false, built: false },
  { name: "commitment.status_changed", family: "commitment", customer_visible: false, built: false },
  { name: "escalation.raised", family: "escalation", customer_visible: false, built: false },
  { name: "escalation.resolved", family: "escalation", customer_visible: false, built: false },
  { name: "handover.scheduled", family: "handover", customer_visible: true, built: false },
  { name: "handover.completed", family: "handover", customer_visible: true, built: true },
  { name: "warranty.case_opened", family: "warranty", customer_visible: true, built: false },
  { name: "warranty.case_closed", family: "warranty", customer_visible: true, built: true },
  { name: "customer_contact.sent", family: "customer_contact", customer_visible: false, built: false },
  { name: "customer_contact.response_received", family: "customer_contact", customer_visible: false, built: false },

  // --- Sanctioned extensions (02 §Appendix B "Extend with ...") ---
  { name: "action.acted", family: "action", customer_visible: false, built: true },
  { name: "document.approved", family: "document", customer_visible: false, built: true },
  { name: "checkin.captured", family: "checkin", customer_visible: false, built: true },

  // --- Canonical-model rule 8 events (04 §Rules "Every mutation emits: ...") ---
  // These aren't literal Appendix B names but 04 requires them, and 02 says event names
  // are data in `event_type` — the registry is the extension point for exactly this.
  { name: "unit.created", family: "unit", customer_visible: false, built: true },
  { name: "unit.sale_status_changed", family: "unit", customer_visible: true, built: true },
  { name: "customer.created", family: "customer", customer_visible: false, built: true },
  // Not built yet — no merge/residency-change/applicant/transfer handler exists until 0003
  // (canonical model) lands. Flip to true in that PR alongside the emit site + test.
  { name: "customer.merged", family: "customer", customer_visible: false, built: false },
  { name: "customer.residency_changed", family: "customer", customer_visible: false, built: false },
  { name: "applicant.added", family: "applicant", customer_visible: false, built: false },
  { name: "applicant.removed", family: "applicant", customer_visible: false, built: false },
  { name: "booking.status_changed", family: "booking", customer_visible: true, built: true },
  { name: "booking.transferred", family: "booking", customer_visible: true, built: false },
];

/** Appendix B (p42) names verbatim — the coverage test's universe. Extensions are exempt by design. */
export const APPENDIX_B_NAMES = new Set<string>([
  "booking.created",
  "sales_handover.submitted",
  "sales_handover.returned",
  "sales_handover.accepted",
  "document.requested",
  "document.received",
  "document.validated",
  "document.rejected",
  "demand.raised",
  "payment.received",
  "payment.reconciled",
  "loan.sanction_received",
  "loan.disbursement_received",
  "agreement.generated",
  "agreement.executed",
  "registration.scheduled",
  "registration.completed",
  "progress.updated",
  "qa.inspection_passed",
  "qa.inspection_failed",
  "snag.opened",
  "snag.closed",
  "commitment.created",
  "commitment.status_changed",
  "escalation.raised",
  "escalation.resolved",
  "handover.scheduled",
  "handover.completed",
  "warranty.case_opened",
  "warranty.case_closed",
  "customer_contact.sent",
  "customer_contact.response_received",
]);
