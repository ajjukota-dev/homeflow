import {
  LayoutDashboard,
  Users2,
  ListChecks,
  Handshake,
  FileText,
  IndianRupee,
  Landmark,
  Scale,
  FileSignature,
  Building2,
  ClipboardCheck,
  KeyRound,
  BadgeCheck,
  MessageSquare,
  AlertOctagon,
  BarChart3,
  Settings,
} from "lucide-react";

// Left-nav definition. `phase1` indicates the item is fully implemented in this build.
// `module` maps the item to a rbac_matrix module for permission gating (Phase B).
export const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, phase1: true, module: "dashboard" },
  {
    key: "journeys",
    label: "Customer Journeys",
    to: "/customer-journeys",
    icon: Users2,
    phase1: true,
    subLabel: "All / My / New Bookings / At Risk / Escalated",
    module: "customer_journey",
  },
  {
    key: "tasks",
    label: "Tasks & Actions",
    to: "/tasks",
    icon: ListChecks,
    phase1: true,
    subLabel: "My Tasks / Queue / Overdue / Approvals",
    module: "customer_tasks",
  },
  { key: "sales-handover", label: "Sales Handover", to: "/sales-handover", icon: Handshake, phase1: true, subLabel: "All / Awaiting Acceptance / Returned / Accepted", module: "sales_handover" },
  { key: "documents", label: "Documents", to: "/documents", icon: FileText, phase1: true, subLabel: "Global document queue", module: "documents" },
  { key: "collections", label: "Collections", to: "/collections", icon: IndianRupee, phase1: true, subLabel: "Dashboard / Ageing / All Payments", module: "collections" },
  { key: "loans", label: "Loans", to: "/loans", icon: Landmark, phase1: true, subLabel: "Bank sanctions & disbursements", module: "loans" },
  { key: "legal", label: "Legal", to: "/legal", icon: Scale, phase1: true, subLabel: "Agreement drafts & approvals", module: "legal" },
  { key: "generate-documents", label: "Generate Documents", to: "/documents/generate", icon: FileSignature, phase1: true, subLabel: "Sale Deed / Agreement / Handover — templated draft PDFs", allowedRoleCodes: ["MANAGEMENT", "CRM", "LEGAL"], module: "documents" },
  { key: "registrations", label: "Registrations", to: "/registrations", icon: FileSignature, phase1: true, subLabel: "SRO slot booking & execution", module: "registrations" },
  { key: "unit-readiness", label: "Unit Readiness", to: "/unit-readiness", icon: Building2, phase1: true, subLabel: "Component progress & Ready-for-QA", module: "unit_readiness" },
  { key: "snagging", label: "Snagging", to: "/snagging", icon: ClipboardCheck, phase1: true, subLabel: "All snags · Critical / Awaiting Verification", module: "snagging" },
  { key: "handovers", label: "Handovers", to: "/handovers", icon: KeyRound, phase1: true, subLabel: "Ready / At Risk / Executed", module: "handovers" },
  { key: "commitments", label: "Customer Commitments", to: "/commitments", icon: BadgeCheck, phase1: true, subLabel: "All / Overdue / Awaiting Approval", module: "commitments" },
  { key: "communications", label: "Communications", to: "/communications", icon: MessageSquare, phase1: true, subLabel: "Every customer touch", module: "communications" },
  { key: "escalations", label: "Escalations", to: "/escalations", icon: AlertOctagon, phase1: true, subLabel: "Rule-based + manual", module: "escalations" },
  { key: "reports", label: "Reports", to: "/reports", icon: BarChart3, phase1: true, subLabel: "Forecast · Pipeline · SLA", module: "reports" },
  {
    key: "administration",
    label: "Administration",
    to: "/admin",
    icon: Settings,
    phase1: true,
    superAdminOnly: true,
    module: "administration",
  },
];

// Spec §100 status colour tokens. Always render with a text label.
// Palette tuned for LED visibility (Feb 2026 theme refresh).
const P = "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap";
export const STATUS_PILL_CLASS = {
  // Completed
  green: `${P} bg-green-100 text-green-800 border-green-300`,
  // In progress / info
  blue: `${P} bg-blue-100 text-blue-800 border-blue-300`,
  // Waiting / pending
  amber: `${P} bg-amber-100 text-amber-800 border-amber-200`,
  // At risk
  orange: `${P} bg-orange-200 text-orange-800 border-orange-300`,
  // Overdue
  red: `${P} bg-red-100 text-red-800 border-red-300`,
  // Critical
  darkred: `${P} bg-red-200 text-red-900 border-red-400`,
  // Blocked
  purple: `${P} bg-violet-100 text-violet-800 border-violet-300`,
  // Cancelled / neutral
  grey: `${P} bg-slate-100 text-slate-600 border-slate-300`,
};

// Semantic mapping per business rule. Booking statuses per spec §100.
export const STATUS_TONE = {
  // Bookings
  Draft: "amber",
  Confirmed: "green",
  Cancelled: "red",
  // Units
  Available: "grey",
  Booked: "blue",
  Registered: "purple",
  "Handed Over": "green",
  // Projects
  Active: "green",
  Handover: "purple",
  Closed: "grey",
  // KYC
  Pending: "amber",
  Received: "blue",
  Verified: "green",
  Rejected: "red",
  // NRI
  Resident: "grey",
  NRI: "blue",
  OCI: "purple",
  // Phase 5 — Milestone status
  "Not Due": "grey",
  "Due Soon": "blue",
  Due: "amber",
  Overdue: "red",
  Paid: "green",
  "Partially Paid": "blue",
  Disputed: "darkred",
  Waived: "grey",
  // Phase 5 — TDS applicability & FC status
  Applicable: "blue",
  "Not Applicable": "grey",
  "Not Determined": "grey",
  Approved: "green",
  // Phase 5 — payment verification status
  Waived_p: "grey",
  // Phase 6 — loan stages
  Application: "amber",
  "Sanction Pending": "amber",
  Sanctioned: "blue",
  "Disbursement Pending": "amber",
  "Partially Disbursed": "blue",
  "Fully Disbursed": "green",
  // `Closed: "grey"` is already declared above for escalations; the duplicate key
  // was silently dropped by the object literal, so removing it changes nothing.
  // Phase 6 — legal status
  "Draft Uploaded": "blue",
  "Under Review": "amber",
  "Deviations Raised": "orange",
  // Phase 6 — registration status
  "Availability Confirmed": "blue",
  "Slot Booked": "purple",
  Executed: "green",
};

export const BOOKING_TRANSITIONS = {
  Draft: ["Confirmed", "Cancelled"],
  Confirmed: ["Cancelled"],
  Cancelled: [],
};
