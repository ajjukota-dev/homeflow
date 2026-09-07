import type { DocumentStatus, TemplateStatus } from "./api";

// 22-document-factory.md Appendix A / Data section vocabularies — never show the raw enum value.

export const DOCUMENT_STATUS_ORDER: DocumentStatus[] = [
  "DRAFT", "INTERNAL_REVIEW", "AWAITING_APPROVAL", "CUSTOMER_REVIEW", "APPROVED_FOR_EXECUTION",
  "FINAL", "ARCHIVED", "REJECTED", "SUPERSEDED",
];

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  DRAFT: "Draft",
  INTERNAL_REVIEW: "Internal review",
  AWAITING_APPROVAL: "Awaiting approval",
  CUSTOMER_REVIEW: "Customer review",
  APPROVED_FOR_EXECUTION: "Approved for execution",
  FINAL: "Final",
  ARCHIVED: "Archived",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
};

export function documentStatusTone(status: DocumentStatus): string {
  if (status === "FINAL" || status === "ARCHIVED") return "bg-ontrack/10 text-ontrack";
  if (status === "REJECTED" || status === "SUPERSEDED") return "bg-overdue/10 text-overdue";
  return "bg-due/10 text-due";
}

export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  DRAFT: "Draft",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  RETIRED: "Retired",
};

export const CLAUSE_TYPE_LABEL: Record<string, string> = {
  LOCKED: "Locked",
  PARAMETERIZED: "Parameterized",
  NEGOTIABLE_WITH_APPROVAL: "Negotiable (needs approval)",
};

export function clauseTypeTone(type: string): string {
  if (type === "LOCKED") return "bg-fg-subtle/10 text-fg-subtle";
  if (type === "NEGOTIABLE_WITH_APPROVAL") return "bg-due/10 text-due";
  return "bg-accent/10 text-accent";
}

/** family_code / category are free-text config (spec: "Families (all configurable)") — prettify
 *  rather than hardcode an enum that would silently go stale as Studio adds new families. */
export function prettifyCode(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const APPROVAL_STAGE_LABEL: Record<string, string> = {
  INTERNAL_REVIEW: "Internal review",
  LEGAL: "Legal",
  COMMERCIAL: "Commercial",
};
