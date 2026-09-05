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
  { name: "loan.sanction_received", family: "loan", customer_visible: false, built: true },
  { name: "loan.disbursement_received", family: "loan", customer_visible: false, built: true },
  { name: "agreement.generated", family: "agreement", customer_visible: false, built: true },
  { name: "agreement.executed", family: "agreement", customer_visible: true, built: true },
  { name: "registration.scheduled", family: "registration", customer_visible: true, built: false },
  { name: "registration.completed", family: "registration", customer_visible: true, built: true },
  { name: "progress.updated", family: "progress", customer_visible: false, built: true },
  { name: "gate.state_changed", family: "gate", customer_visible: false, built: true },
  { name: "gate.exception_granted", family: "gate", customer_visible: false, built: true },
  { name: "gate.exception_revoked", family: "gate", customer_visible: false, built: true },
  { name: "gate.exception_expired", family: "gate", customer_visible: false, built: true },
  { name: "gate.rules_published", family: "gate", customer_visible: false, built: true },
  { name: "prospect.created", family: "sales", customer_visible: false, built: true },
  { name: "need.captured", family: "sales", customer_visible: false, built: true },
  { name: "match.computed", family: "sales", customer_visible: false, built: true },
  { name: "hold.requested", family: "hold", customer_visible: false, built: true },
  { name: "hold.approved", family: "hold", customer_visible: false, built: true },
  { name: "hold.rejected", family: "hold", customer_visible: false, built: true },
  { name: "hold.expired", family: "hold", customer_visible: false, built: true },
  { name: "hold.released", family: "hold", customer_visible: false, built: true },
  { name: "hold.consumed", family: "hold", customer_visible: false, built: true },
  { name: "qa.inspection_passed", family: "qa", customer_visible: false, built: true },
  { name: "qa.inspection_failed", family: "qa", customer_visible: false, built: true },
  { name: "qa.evidence_verified", family: "qa", customer_visible: false, built: true },
  { name: "dependency.status_changed", family: "qa", customer_visible: false, built: true },
  { name: "snag.opened", family: "snag", customer_visible: false, built: true },
  { name: "snag.assigned", family: "snag", customer_visible: false, built: true },
  { name: "snag.ready_for_verification", family: "snag", customer_visible: false, built: true },
  { name: "snag.verified", family: "snag", customer_visible: true, built: true },
  { name: "snag.reopened", family: "snag", customer_visible: true, built: true },
  { name: "snag.closed", family: "snag", customer_visible: true, built: true },
  { name: "commitment.created", family: "commitment", customer_visible: false, built: true },
  { name: "commitment.status_changed", family: "commitment", customer_visible: false, built: true },
  { name: "escalation.raised", family: "escalation", customer_visible: false, built: true },
  { name: "escalation.resolved", family: "escalation", customer_visible: false, built: true },
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
  // 12-escalations-notifications.md names escalation.raised/resolved but not the tier-progression
  // or closed transitions its own rule 1/table actually needs, nor its notification events.
  { name: "escalation.tier_changed", family: "escalation", customer_visible: false, built: true },
  { name: "escalation.closed", family: "escalation", customer_visible: false, built: true },
  { name: "notification.sent", family: "notification", customer_visible: false, built: true },
  { name: "digest.sent", family: "notification", customer_visible: false, built: true },
  // 13-promise-ledger.md names commitment.created/status_changed (Appendix B, now built above)
  // plus these 4 lifecycle-specific events its own Events list also requires.
  { name: "commitment.at_risk", family: "commitment", customer_visible: false, built: true },
  { name: "commitment.breached", family: "commitment", customer_visible: false, built: true },
  { name: "commitment.fulfilled", family: "commitment", customer_visible: false, built: true },
  { name: "commitment.waived", family: "commitment", customer_visible: false, built: true },

  // --- Canonical-model rule 8 events (04 §Rules "Every mutation emits: ...") ---
  // These aren't literal Appendix B names but 04 requires them, and 02 says event names
  // are data in `event_type` — the registry is the extension point for exactly this.
  { name: "unit.created", family: "unit", customer_visible: false, built: true },
  { name: "unit.sale_status_changed", family: "unit", customer_visible: true, built: true },
  { name: "customer.created", family: "customer", customer_visible: false, built: true },
  { name: "customer.merged", family: "customer", customer_visible: false, built: true },
  { name: "customer.residency_changed", family: "customer", customer_visible: false, built: true },
  { name: "applicant.added", family: "applicant", customer_visible: false, built: true },
  { name: "applicant.removed", family: "applicant", customer_visible: false, built: true },
  { name: "booking.status_changed", family: "booking", customer_visible: true, built: true },
  { name: "booking.transferred", family: "booking", customer_visible: true, built: true },

  // --- Journey Template Studio (05-journey-templates.md) ---
  { name: "template.version_published", family: "template", customer_visible: false, built: true },
  { name: "template.assigned_to_project", family: "template", customer_visible: false, built: true },
  { name: "journey.migration_offered", family: "journey", customer_visible: false, built: true },

  // --- Journey instances & SLA engine (06-timeline-sla-engine.md) ---
  { name: "journey.started", family: "journey", customer_visible: true, built: true },
  { name: "journey.held", family: "journey", customer_visible: false, built: true },
  { name: "journey.resumed", family: "journey", customer_visible: false, built: true },
  { name: "journey.closed", family: "journey", customer_visible: false, built: true },
  { name: "stage.completed", family: "stage", customer_visible: true, built: true },
  // Not a literal 06 name — rule 7 ("reopening requires a reason ... logs why") needs a real
  // emit site, same class of sanctioned extension as 05's 3.
  { name: "task_instance.reopened", family: "task_instance", customer_visible: false, built: true },

  // --- Universal Action (10-universal-action.md) — literal Events section names ---
  { name: "action.created", family: "action", customer_visible: false, built: true },
  { name: "action.status_changed", family: "action", customer_visible: false, built: true },
  { name: "action.closed", family: "action", customer_visible: false, built: true },
  { name: "action.cancelled", family: "action", customer_visible: false, built: true },
  { name: "action.reassigned", family: "action", customer_visible: false, built: true },
  { name: "action.evidence_verified", family: "action", customer_visible: false, built: true },

  // --- Policy Studio (25-policy-studio.md) — literal Events section name ---
  { name: "policy.changed", family: "policy", customer_visible: false, built: true },

  // --- Collections (19-collections-true-risk.md) — literal Events section names ---
  { name: "demand.status_changed", family: "demand", customer_visible: false, built: false },
  { name: "demand.reason_recorded", family: "demand", customer_visible: false, built: true },
  { name: "payment.disputed", family: "payment", customer_visible: false, built: true },
  { name: "tds.verified", family: "tds", customer_visible: false, built: true },
  { name: "tds.rejected", family: "tds", customer_visible: false, built: true },
  { name: "waiver.requested", family: "waiver", customer_visible: false, built: true },
  { name: "waiver.approved", family: "waiver", customer_visible: false, built: true },
  // Not a literal spec-19 name (its Events list says only "waiver.requested/approved") — a
  // rejected waiver recorded under the "approved" event name would be a false audit trail,
  // same class of sanctioned extension 05/06 already used for their own gaps.
  { name: "waiver.rejected", family: "waiver", customer_visible: false, built: true },
  { name: "clearance.approved", family: "clearance", customer_visible: false, built: true },
  { name: "clearance.rejected", family: "clearance", customer_visible: false, built: true },

  // --- Loans (21-loans.md) — literal Events section names, plus loan.withdrawn (sanctioned
  // extension: the spec names only "loan.rejected", but reusing that name for an actual
  // WITHDRAWN outcome would be a false audit trail — same class of extension waiver.rejected
  // already established for spec 19) ---
  { name: "loan.application_submitted", family: "loan", customer_visible: false, built: true },
  { name: "loan.stage_changed", family: "loan", customer_visible: false, built: true },
  { name: "loan.blocker_recorded", family: "loan", customer_visible: false, built: true },
  { name: "loan.blocker_resolved", family: "loan", customer_visible: false, built: true },
  { name: "loan.rejected", family: "loan", customer_visible: false, built: true },
  { name: "loan.withdrawn", family: "loan", customer_visible: false, built: true },
  // 07 unit progress control — Appendix B has progress.updated only; these are its extensions.
  { name: "progress.reopened", family: "progress", customer_visible: false, built: true },
  { name: "progress.bulk_applied", family: "progress", customer_visible: false, built: true },
  { name: "progress.stale", family: "progress", customer_visible: false, built: true },
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
