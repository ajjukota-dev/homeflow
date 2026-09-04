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
