// Human labels for the raw snake_case/SCREAMING_SNAKE enum values the API returns
// (they mirror the spec on purpose — see CLAUDE.md). UI-only translation layer:
// never rename anything upstream, always fall back to a readable string.

/** Unknown-value fallback: never crash, never render undefined. */
function titleCase(raw: string): string {
  const words = raw.trim().split(/[_-]+/).filter(Boolean);
  if (words.length === 0) return raw;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function lookup<T extends string>(map: Record<T, string>, value: string): string {
  return (map as Record<string, string>)[value] ?? titleCase(value);
}

// Unit.sale_status (data-model.md) — available | held | booked | registered | handed_over
type SaleStatus = "available" | "held" | "booked" | "registered" | "handed_over";
const SALE_STATUS: Record<SaleStatus, string> = {
  available: "Available",
  held: "Held",
  booked: "Booked",
  registered: "Registered",
  handed_over: "Handed over",
};
export const saleStatusLabel = (v: string) => lookup(SALE_STATUS, v);

// Booking.status — submitted | active | returned
type BookingStatus = "submitted" | "active" | "returned";
const BOOKING_STATUS: Record<BookingStatus, string> = {
  submitted: "Submitted",
  active: "Active",
  returned: "Returned",
};
export const bookingStatusLabel = (v: string) => lookup(BOOKING_STATUS, v);

// Customer.kyc_status — pending | verified
type KycStatus = "pending" | "verified";
const KYC_STATUS: Record<KycStatus, string> = {
  pending: "Pending",
  verified: "Verified",
};
export const kycStatusLabel = (v: string) => lookup(KYC_STATUS, v);

// GeneratedDocument.status ("none" is the UI sentinel for "not generated yet")
type DocumentStatus = "none" | "draft" | "legal_approved" | "executed" | "archived";
const DOCUMENT_STATUS: Record<DocumentStatus, string> = {
  none: "Not generated",
  draft: "Draft",
  legal_approved: "Legal approved",
  executed: "Executed",
  archived: "Archived",
};
export const documentStatusLabel = (v: string) => lookup(DOCUMENT_STATUS, v);

// RegistrationCase.status (roles/legal/spec.md) — full 5-state lifecycle
type RegistrationStatus = "not_ready" | "readiness_in_progress" | "ready" | "slot_booked" | "completed";
const REGISTRATION_STATUS: Record<RegistrationStatus, string> = {
  not_ready: "Not ready",
  readiness_in_progress: "Readiness in progress",
  ready: "Ready",
  slot_booked: "Slot booked",
  completed: "Completed",
};
export const registrationStatusLabel = (v: string) => lookup(REGISTRATION_STATUS, v);

// Snag.severity (unit-twin.md §2.6) — critical | major | minor
type SnagSeverity = "critical" | "major" | "minor";
const SNAG_SEVERITY: Record<SnagSeverity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};
export const snagSeverityLabel = (v: string) => lookup(SNAG_SEVERITY, v);

// HandoverGate.gate_type (gates.md Part B.1)
type HandoverGateType =
  | "financial"
  | "legal"
  | "registration"
  | "physical"
  | "quality"
  | "commitments"
  | "customer"
  | "fm";
const HANDOVER_GATE_TYPE: Record<HandoverGateType, string> = {
  financial: "Financial clearance",
  legal: "Legal",
  registration: "Registration",
  physical: "Physical",
  quality: "Quality",
  commitments: "Commitments",
  customer: "Customer",
  fm: "FM/Community",
};
export const gateTypeLabel = (v: string) => lookup(HANDOVER_GATE_TYPE, v);

// HandoverGate.state (per-gate run state, distinct from the 5-state changeability GateState)
type GateRunState = "open" | "passed";
const GATE_RUN_STATE: Record<GateRunState, string> = {
  open: "Open",
  passed: "Passed",
};
export const gateRunStateLabel = (v: string) => lookup(GATE_RUN_STATE, v);

// DLP window status
type DlpWindowStatus = "active";
const DLP_WINDOW_STATUS: Record<DlpWindowStatus, string> = {
  active: "Active",
};
export const dlpWindowStatusLabel = (v: string) => lookup(DLP_WINDOW_STATUS, v);

// WarrantyCase.status
type WarrantyCaseStatus = "open" | "closed";
const WARRANTY_CASE_STATUS: Record<WarrantyCaseStatus, string> = {
  open: "Open",
  closed: "Closed",
};
export const warrantyCaseStatusLabel = (v: string) => lookup(WARRANTY_CASE_STATUS, v);

// Control Tower Intervention.category (management/spec.md) — the five ranked lenses
type InterventionCategory = "customer" | "cash" | "handover" | "reputation" | "margin";
const INTERVENTION_CATEGORY: Record<InterventionCategory, string> = {
  customer: "Customer",
  cash: "Cash",
  handover: "Handover",
  reputation: "Reputation",
  margin: "Margin",
};
export const interventionCategoryLabel = (v: string) => lookup(INTERVENTION_CATEGORY, v);

// Commitment.status (13-promise-ledger.md Appendix A)
type CommitmentStatus = "DRAFT" | "APPROVED" | "ACTIVE" | "AT_RISK" | "FULFILLED" | "BREACHED" | "WAIVED_CANCELLED";
const COMMITMENT_STATUS: Record<CommitmentStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  ACTIVE: "Active",
  AT_RISK: "At risk",
  FULFILLED: "Fulfilled",
  BREACHED: "Breached",
  WAIVED_CANCELLED: "Waived / Cancelled",
};
export const commitmentStatusLabel = (v: string) => lookup(COMMITMENT_STATUS, v);

// Commitment.category
type CommitmentCategory = "MODIFICATION" | "COMMERCIAL" | "TIMELINE" | "COMPLIMENTARY_ITEM" | "SPECIFICATION_UPGRADE" | "SERVICE" | "OTHER";
const COMMITMENT_CATEGORY: Record<CommitmentCategory, string> = {
  MODIFICATION: "Modification",
  COMMERCIAL: "Commercial",
  TIMELINE: "Timeline",
  COMPLIMENTARY_ITEM: "Complimentary item",
  SPECIFICATION_UPGRADE: "Specification upgrade",
  SERVICE: "Service",
  OTHER: "Other",
};
export const commitmentCategoryLabel = (v: string) => lookup(COMMITMENT_CATEGORY, v);

// Commitment.breach_root_cause
type BreachRootCause = "DEPENDENCY" | "RESOURCE" | "VENDOR" | "SCOPE_MISUNDERSTOOD" | "OVERPROMISED" | "CUSTOMER" | "FORCE_MAJEURE";
const BREACH_ROOT_CAUSE: Record<BreachRootCause, string> = {
  DEPENDENCY: "Dependency",
  RESOURCE: "Resource",
  VENDOR: "Vendor",
  SCOPE_MISUNDERSTOOD: "Scope misunderstood",
  OVERPROMISED: "Overpromised",
  CUSTOMER: "Customer",
  FORCE_MAJEURE: "Force majeure",
};
export const breachRootCauseLabel = (v: string) => lookup(BREACH_ROOT_CAUSE, v);

// Event log plain-language rendering (spec 02 Screens: "Activity tab ... rendering events in
// plain language via labels.ts"). Falls back to a readable version of the dotted type name
// for any event not covered here yet.
export interface ActivityEvent {
  type: string;
  payload: Record<string, unknown>;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : String(v ?? "");
}

const EVENT_DESCRIBERS: Record<string, (p: Record<string, unknown>) => string> = {
  "booking.created": (p) => `Booking ${p.booking_number ?? ""} created for ${fmtMoney(p.total_consideration)}`.trim(),
  "sales_handover.submitted": () => "Submitted to CRM for review",
  "sales_handover.returned": (p) => `Returned by CRM${p.reason ? `: ${p.reason}` : ""}`,
  "sales_handover.accepted": (p) => `Accepted by CRM${p.rm_owner ? ` — RM ${p.rm_owner}` : ""}`,
  "demand.raised": (p) => `Demand raised for ${fmtMoney(p.amount)}${p.due_date ? ` due ${p.due_date}` : ""}`,
  "payment.received": (p) => `Payment of ${fmtMoney(p.amount)} received`,
  "payment.reconciled": (p) => `Payment of ${fmtMoney(p.amount)} reconciled`,
  "agreement.generated": (p) => `${p.document_family ?? "Agreement"} drafted (v${p.version ?? 1})`,
  "agreement.executed": (p) => `${p.document_family ?? "Agreement"} executed`,
  "document.approved": (p) => `${p.document_family ?? "Document"} approved`,
  "registration.completed": (p) => `Registration completed${p.sro_reference ? ` (${p.sro_reference})` : ""}`,
  "progress.updated": (p) => `${p.component ?? "Component"} moved from ${p.from ?? "—"} to ${p.to ?? "—"}`,
  "qa.inspection_passed": (p) => `${p.component ?? "Component"} passed QA inspection`,
  "snag.closed": () => "Snag closed with before/after evidence",
  "handover.completed": () => "Handover completed",
  "warranty.case_closed": () => "Warranty case closed",
  "action.acted": (p) => `Action taken on "${p.headline ?? "intervention"}"`,
  "checkin.captured": (p) => `Check-in captured — satisfaction ${p.satisfaction_score ?? "—"}/5`,
  "unit.created": (p) => `Unit ${p.unit_number ?? ""} created`.trim(),
  "unit.sale_status_changed": (p) => `Sale status changed from ${p.from ?? "—"} to ${p.to ?? "—"}`,
  "customer.created": (p) => `Customer ${p.display_name ?? ""} created`.trim(),
  "booking.status_changed": (p) => `Booking status changed from ${p.from ?? "—"} to ${p.to ?? "—"}`,
  "commitment.created": (p) => `Commitment ${p.code ?? ""} created (${commitmentCategoryLabel(String(p.category ?? ""))})`.trim(),
  "commitment.status_changed": (p) => `Commitment ${commitmentStatusLabel(String(p.from ?? ""))} → ${commitmentStatusLabel(String(p.to ?? ""))}`,
  "commitment.at_risk": (p) => `Commitment flagged at risk${p.reason ? `: ${p.reason}` : ""}`,
  "commitment.breached": () => "Commitment breached — due date passed unfulfilled",
  "commitment.fulfilled": () => "Commitment fulfilled",
  "commitment.waived": (p) => `Commitment waived${p.reason ? `: ${p.reason}` : ""}`,
};

export function eventDescription(event: ActivityEvent): string {
  const describer = EVENT_DESCRIBERS[event.type];
  if (describer) return describer(event.payload ?? {});
  return titleCase(event.type.replace(/\./g, " "));
}

export function eventFamily(type: string): string {
  return type.split(".")[0];
}
