import type { Importance } from "./api";

// Named toggle filters (24-sales-inventory-discovery.md rule 1, p14 §8.7.1). "Bathroom
// Specification Open" is omitted — sales_policy.filter_categories has no bathroom mapping (no
// such category is seeded yet; see services/api/src/sales/policy.ts's own DEFAULT_SALES_POLICY).
export const NAMED_FILTERS: { key: string; label: string }[] = [
  { key: "highly_customisable", label: "Highly Customisable" },
  { key: "layout_flexible", label: "Layout Flexible" },
  { key: "kitchen_open", label: "Kitchen Changes Open" },
  { key: "electrical_open", label: "Electrical Changes Open" },
  { key: "flooring_open", label: "Flooring Selection Open" },
  { key: "ready_to_move", label: "Ready-to-Move" },
  { key: "closing_soon", label: "Closing soon" },
];

// The real seeded 4-code list (07/08's own backend build notes) — same small-duplicated-constant
// pattern already established by 08's ChangeGateRuleStudio.tsx / 18's CHANGE_CATEGORIES.
export const CHANGE_CATEGORIES = ["kitchen_layout", "electrical", "flooring_selection", "structural"] as const;
export const CATEGORY_LABEL: Record<string, string> = { kitchen_layout: "Kitchen layout", electrical: "Electrical", flooring_selection: "Flooring selection", structural: "Structural" };

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  MUST_HAVE: "Must Have",
  PREFERRED: "Preferred",
  NOT_IMPORTANT: "Not Important",
};

// sales/holds.ts's real change_window_hold.status enum.
export const HOLD_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  RELEASED: "Released",
  CONSUMED: "Consumed",
};

// sales/prospects.ts's real prospect.status enum.
export const PROSPECT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  BOOKED: "Booked",
  LOST: "Lost",
};

export function possessionLabel(w: { from: string; to: string; confidence: string } | null): string {
  if (!w) return "No handover date set";
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return `${fmt(w.from)} – ${fmt(w.to)} (${w.confidence.toLowerCase()} confidence)`;
}
