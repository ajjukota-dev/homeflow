// Collaboration constants and permission helpers (client-side mirror of server rules).

export const CATEGORY_OPTIONS = [
  "KYC", "Booking", "Cost Sheet", "Agreement", "TDS", "Loan",
  "Registration", "POA", "Handover", "Snag", "Other",
];

export const VISIBILITY_OPTIONS = ["Internal", "Customer Visible"];

export const VERIFICATION_STATUS_OPTIONS = ["Uploaded", "Under Review", "Verified", "Rejected"];

export const VERIFICATION_TONE = {
  Uploaded: "amber",
  "Under Review": "blue",
  Verified: "green",
  Rejected: "red",
};

export const COMMENT_VISIBILITY_TONE = {
  Internal: "grey",
  "Customer Visible": "amber",
};

export const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx", ".csv"];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const CUSTOMER_VISIBLE_ROLES = new Set(["MANAGEMENT", "CRM", "LEGAL"]);
const VERIFY_ROLES = new Set(["MANAGEMENT", "ACCOUNTS", "LEGAL", "REGISTRATION", "QA", "CRM"]);

export function isSuperAdmin(user) {
  return Boolean(user?.role?.is_super_admin);
}

export function canPostCustomerVisible(user) {
  return isSuperAdmin(user) || CUSTOMER_VISIBLE_ROLES.has(user?.role?.code);
}

export function canVerify(user) {
  return isSuperAdmin(user) || VERIFY_ROLES.has(user?.role?.code);
}

export function canReadAudit(user) {
  return isSuperAdmin(user) || user?.role?.code === "MANAGEMENT";
}

export function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function entityPath(entityType, entityId) {
  switch (entityType) {
    case "customer":
      return `/customers/${entityId}`;
    case "unit":
      return `/units/${entityId}`;
    case "booking":
      return `/bookings/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "task":
      return `/tasks?task=${entityId}`;
    case "journey":
      return `/customer-journeys`;
    case "sales_handover":
      return `/sales-handover`;
    case "document":
      return `/documents`;
    case "customer_commitment":
      return `/commitments`;
    default:
      return "/dashboard";
  }
}
