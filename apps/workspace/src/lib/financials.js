// Phase 5 shared constants + tone maps + role helpers.
import { isSuperAdmin } from "@/lib/collab";

export const PAYMENT_MODES = ["Bank Transfer", "Cheque", "DD", "RTGS", "NEFT", "UPI", "Other"];

export const SCHEDULE_TEMPLATES = [
  "30-40-30",
  "Construction Linked (10-40-40-10)",
  "Handover Bias (20-60-20)",
];

// Milestone.status tone (§100 palette)
export const MILESTONE_STATUS_TONE = {
  "Not Due": "grey",
  "Due Soon": "blue",
  Due: "amber",
  Overdue: "red",
  Paid: "green",
  "Partially Paid": "blue",
  Disputed: "darkred",
  Waived: "grey",
};

export const PAYMENT_STATUS_TONE = {
  Pending: "amber",
  Verified: "green",
  Rejected: "red",
  Disputed: "darkred",
  Waived: "grey",
};

export const TDS_APPLICABILITY_TONE = {
  Applicable: "blue",
  "Not Applicable": "grey",
  "Not Determined": "grey",
};

export const TDS_VERIFICATION_TONE = {
  Pending: "amber",
  "Not Required": "grey",
  Verified: "green",
  Rejected: "red",
};

export const FC_STATUS_TONE = {
  Pending: "amber",
  Approved: "green",
  Rejected: "red",
};

export const AGEING_BUCKETS = ["Current", "1-7", "8-15", "16-30", "31-60", "61-90", "90+"];

// FC checklist items — labels + which department/role
export const FC_CHECKLIST_ITEMS = [
  { key: "ledger_reconciled", label: "Ledger reconciled with all receipts" },
  { key: "due_amounts_paid", label: "All due milestones paid" },
  { key: "tds_verified", label: "TDS verified (or marked Not Applicable)" },
  { key: "bank_disbursement_applicable", label: "Bank loan applicable to this booking" },
  { key: "bank_disbursement_received", label: "Bank disbursement received (only if applicable)" },
  { key: "other_charges_cleared", label: "Other charges cleared (registration, stamp duty, etc.)" },
  { key: "exceptions_approved", label: "Any exceptions approved by Management" },
];

// RBAC helpers — client mirror of server rules.
const FINANCE_ROLES = new Set(["ACCOUNTS", "MANAGEMENT"]);
const RECORD_PAYMENT_ROLES = new Set(["ACCOUNTS", "MANAGEMENT", "SALES"]);
const TDS_MANAGE_ROLES = new Set(["ACCOUNTS", "MANAGEMENT", "CRM"]);
const TDS_VERIFY_ROLES = new Set(["ACCOUNTS", "MANAGEMENT"]);

export function canManageFinance(user) {
  return isSuperAdmin(user) || FINANCE_ROLES.has(user?.role?.code);
}
export function canRecordPayment(user) {
  return isSuperAdmin(user) || RECORD_PAYMENT_ROLES.has(user?.role?.code);
}
export function canManageTDS(user) {
  return isSuperAdmin(user) || TDS_MANAGE_ROLES.has(user?.role?.code);
}
export function canVerifyTDS(user) {
  return isSuperAdmin(user) || TDS_VERIFY_ROLES.has(user?.role?.code);
}
export function canWaive(user) {
  return isSuperAdmin(user);
}

export function toneForDaysDelta(days) {
  if (days == null) return "grey";
  if (days >= 30) return "red";
  if (days >= 15) return "orange";
  if (days >= 7) return "amber";
  if (days >= 0) return "amber";
  return "grey";
}
