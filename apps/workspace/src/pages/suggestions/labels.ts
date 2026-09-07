import type { LlmTaskKind } from "./api";

export const KIND_LABEL: Record<LlmTaskKind, string> = {
  COMMITMENT_DETECTION: "Detected commitment",
  COMMUNICATION_SUMMARY: "Communication summary",
  SENTIMENT: "Sentiment",
  DOCUMENT_FIELD_EXTRACTION: "Document field extraction",
  DOCUMENT_INCONSISTENCY: "Document inconsistency",
  SNAG_ROOT_CAUSE_SUGGESTION: "Snag root-cause suggestion",
};

// Rule 7's "Suggestions inbox per role" — CRM: commitments/summaries/sentiment; Legal/CRM:
// document extractions/inconsistencies; QA: root-cause. MANAGEMENT/SUPER_ADMIN see everything
// (same "read access is any staff role" precedent as journey-control/queues), matching this
// codebase's general staff-visibility convention rather than a hard department wall.
export const KIND_ROLES: Record<LlmTaskKind, string[]> = {
  COMMITMENT_DETECTION: ["CRM", "MANAGEMENT", "SUPER_ADMIN"],
  COMMUNICATION_SUMMARY: ["CRM", "MANAGEMENT", "SUPER_ADMIN"],
  SENTIMENT: ["CRM", "MANAGEMENT", "SUPER_ADMIN"],
  DOCUMENT_FIELD_EXTRACTION: ["LEGAL", "CRM", "MANAGEMENT", "SUPER_ADMIN"],
  DOCUMENT_INCONSISTENCY: ["LEGAL", "CRM", "MANAGEMENT", "SUPER_ADMIN"],
  SNAG_ROOT_CAUSE_SUGGESTION: ["QA", "MANAGEMENT", "SUPER_ADMIN"],
};

export function confidenceLabel(c: number | null): string {
  if (c === null) return "No confidence given";
  if (c >= 0.7) return `${Math.round(c * 100)}% confidence`;
  if (c >= 0.4) return `${Math.round(c * 100)}% confidence — review carefully`;
  return `${Math.round(c * 100)}% confidence — low, treat as a starting point only`;
}
