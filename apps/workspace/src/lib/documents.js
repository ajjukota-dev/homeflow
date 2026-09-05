// Phase 4: Documents + Commitments UI helpers.

export const DOC_CATEGORIES = [
  "PAN", "Identity Proof", "Address Proof", "Passport", "OCI",
  "Booking Form", "Cost Sheet", "Agreement", "TDS", "Loan Documents",
  "Registration Documents", "POA", "Handover Documents", "Other",
];

export const DOC_STATUS_TONE = {
  Required: "amber",
  Received: "blue",
  "Under Review": "purple",
  Verified: "green",
  Rejected: "red",
  Expired: "orange",
  "Not Applicable": "grey",
};

export const COMMITMENT_CATEGORIES = [
  "Modification", "Commercial Promise", "Timeline Promise",
  "Complimentary Item", "Specification Upgrade", "Other",
];

export const COMMITMENT_STATUS_TONE = {
  Draft: "grey",
  "Awaiting Approval": "amber",
  Approved: "blue",
  "In Progress": "blue",
  Completed: "green",
  "Customer Confirmed": "green",
  Rejected: "red",
  Cancelled: "grey",
  Overdue: "darkred",
};

export const APPROVAL_STATUS_TONE = {
  "Not Required": "grey",
  Pending: "amber",
  Approved: "green",
  Rejected: "red",
};

export const HANDOVER_STATUS_TONE = {
  Draft: "grey",
  Submitted: "blue",
  Accepted: "green",
  Returned: "amber",
};

// Roles allowed to verify a doc by category (mirrors backend CATEGORY_TO_VERIFIER_ROLE)
export const DOC_CATEGORY_VERIFIER = {
  PAN: "CRM",
  "Identity Proof": "CRM",
  "Address Proof": "CRM",
  Passport: "CRM",
  OCI: "CRM",
  "Booking Form": "CRM",
  "Cost Sheet": "CRM",
  Agreement: "LEGAL",
  POA: "LEGAL",
  TDS: "ACCOUNTS",
  "Loan Documents": "ACCOUNTS",
  "Registration Documents": "REGISTRATION",
  "Handover Documents": "HANDOVER",
  Other: "CRM",
};

export function canVerifyDocument(user, category) {
  if (!user) return false;
  if (user.role?.is_super_admin) return true;
  if (user.role?.code === "MANAGEMENT") return true;
  return DOC_CATEGORY_VERIFIER[category] === user.role?.code;
}

export function canManageDocuments(user) {
  if (!user) return false;
  return user.role?.is_super_admin || user.role?.code === "CRM";
}

export function displayCommitmentStatus(c) {
  if (c?.overdue && !["Completed", "Customer Confirmed", "Cancelled", "Rejected"].includes(c.delivery_status)) {
    return "Overdue";
  }
  return c?.delivery_status || "Draft";
}
