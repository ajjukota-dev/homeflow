import type { CrStatus } from "./api";

// 18-change-requests.md Appendix A statuses, in board order — kanban columns render in this
// order. Terminal-but-distinct outcomes (REJECTED/WITHDRAWN/CANCELLED) are their own columns
// too, matching the spec's own "kanban by status" literally rather than collapsing them away.
export const CR_STATUS_ORDER: CrStatus[] = [
  "REQUESTED", "FEASIBILITY_REVIEW", "COSTING", "AWAITING_APPROVAL", "AWAITING_CUSTOMER",
  "AWAITING_PAYMENT", "APPROVED", "RELEASED", "IN_PROGRESS", "READY_FOR_QA", "QA_VERIFIED",
  "CUSTOMER_ACCEPTED", "AS_BUILT_CLOSED", "REJECTED", "WITHDRAWN", "CANCELLED",
];

export const CR_STATUS_LABEL: Record<CrStatus, string> = {
  DRAFT: "Draft",
  REQUESTED: "Requested",
  FEASIBILITY_REVIEW: "Feasibility review",
  COSTING: "Costing",
  AWAITING_APPROVAL: "Awaiting approval",
  AWAITING_CUSTOMER: "Awaiting customer",
  AWAITING_PAYMENT: "Awaiting payment",
  APPROVED: "Approved",
  RELEASED: "Released",
  IN_PROGRESS: "In progress",
  READY_FOR_QA: "Ready for QA",
  QA_VERIFIED: "QA verified",
  CUSTOMER_ACCEPTED: "Customer accepted",
  AS_BUILT_CLOSED: "As-built closed",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  CANCELLED: "Cancelled",
};

export const CR_TERMINAL: CrStatus[] = ["REJECTED", "WITHDRAWN", "CANCELLED", "AS_BUILT_CLOSED"];

// 08-changeability-engine.md's own 4 change_category codes (kitchen_layout/electrical/
// flooring_selection/structural) — the only categories the gate engine (and this CR's own
// primary_category_code) ever routes on.
export const CHANGE_CATEGORIES = ["kitchen_layout", "electrical", "flooring_selection", "structural"] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  kitchen_layout: "Kitchen layout",
  electrical: "Electrical",
  flooring_selection: "Flooring selection",
  structural: "Structural",
};
