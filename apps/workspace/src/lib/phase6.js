// Phase 6 shared tones + RBAC helpers.
import { isSuperAdmin } from "@/lib/collab";

// Loan stage tone map
export const LOAN_STAGE_TONE = {
  Application: "amber",
  "Sanction Pending": "amber",
  Sanctioned: "blue",
  "Disbursement Pending": "amber",
  "Partially Disbursed": "blue",
  "Fully Disbursed": "green",
  Closed: "grey",
  Rejected: "red",
};

export const LOAN_EVENT_META = {
  "Application Submitted": { tone: "amber", label: "Application" },
  Sanctioned: { tone: "blue", label: "Sanctioned" },
  "Disbursement Requested": { tone: "amber", label: "Disbursement requested" },
  Disbursed: { tone: "green", label: "Disbursed" },
  Rejected: { tone: "red", label: "Rejected" },
  Cancelled: { tone: "grey", label: "Cancelled" },
  "Blocker Recorded": { tone: "darkred", label: "Blocker recorded" },
  "Blocker Resolved": { tone: "green", label: "Blocker resolved" },
};

export const LEGAL_STATUS_TONE = {
  "Not Started": "grey",
  "Draft Uploaded": "blue",
  "Under Review": "amber",
  "Deviations Raised": "orange",
  Approved: "green",
  Rejected: "red",
};

export const REG_STATUS_TONE = {
  "Not Started": "grey",
  "Availability Confirmed": "blue",
  "Slot Booked": "purple",
  Executed: "green",
  Closed: "green",
};

// RBAC — mirror server rules
const LOAN_MANAGE = new Set(["BANKING", "ACCOUNTS", "MANAGEMENT"]);
const LEGAL_MANAGE = new Set(["LEGAL", "MANAGEMENT"]);
const REG_CONFIRM = new Set(["CRM", "REGISTRATION", "MANAGEMENT"]);
const REG_BOOK = new Set(["REGISTRATION", "MANAGEMENT"]);

export function canManageLoan(user) {
  return isSuperAdmin(user) || LOAN_MANAGE.has(user?.role?.code);
}
export function canManageLegal(user) {
  return isSuperAdmin(user) || LEGAL_MANAGE.has(user?.role?.code);
}
export function canConfirmAvailability(user) {
  return isSuperAdmin(user) || REG_CONFIRM.has(user?.role?.code);
}
export function canBookSlot(user) {
  return isSuperAdmin(user) || REG_BOOK.has(user?.role?.code);
}
