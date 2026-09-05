// Phase 7 shared tones + RBAC helpers.
import { isSuperAdmin } from "@/lib/collab";

export const READINESS_COMPONENTS = [
  { name: "Civil", weight: 0.15 },
  { name: "Flooring", weight: 0.10 },
  { name: "Doors", weight: 0.05 },
  { name: "Windows", weight: 0.05 },
  { name: "Painting", weight: 0.10 },
  { name: "Electrical", weight: 0.10 },
  { name: "Plumbing", weight: 0.10 },
  { name: "Sanitary", weight: 0.05 },
  { name: "Kitchen", weight: 0.10 },
  { name: "HVAC", weight: 0.05 },
  { name: "Utilities", weight: 0.05 },
  { name: "External Works", weight: 0.05 },
  { name: "Cleaning", weight: 0.03 },
  { name: "Common Area Dependencies", weight: 0.02 },
];

export const SNAG_ROOMS = ["Living", "Kitchen", "Master Bedroom", "Bedroom 2", "Bedroom 3", "Bathroom 1", "Bathroom 2", "Utility", "Balcony", "Common", "Other"];
export const SNAG_CATEGORIES = ["Civil", "Electrical", "Plumbing", "Painting", "Flooring", "Fittings", "Cleaning", "Other"];
export const SNAG_SEVERITIES = ["Critical", "Major", "Minor"];
export const SNAG_STATUSES = ["Open", "Assigned", "In Progress", "Ready for Verification", "Verified", "Closed", "Reopened"];

export const SNAG_SEVERITY_TONE = { Critical: "darkred", Major: "red", Minor: "amber" };
export const SNAG_STATUS_TONE = {
  Open: "grey",
  Assigned: "blue",
  "In Progress": "amber",
  "Ready for Verification": "purple",
  Verified: "green",
  Closed: "green",
  Reopened: "orange",
};

export const HANDOVER_GATE_TONE = { Green: "green", Amber: "amber", Red: "red" };
export const HANDOVER_STATUS_TONE = {
  "Not Started": "grey",
  Scheduling: "blue",
  Ready: "green",
  Executed: "purple",
  Closed: "green",
};

// RBAC — mirror server rules
const SITE_MANAGE = new Set(["SITE", "MANAGEMENT"]);
const QA_MANAGE = new Set(["QA", "SITE", "MANAGEMENT"]);
const QA_VERIFY = new Set(["QA", "MANAGEMENT"]);
const HANDOVER_MANAGE = new Set(["HANDOVER", "MANAGEMENT"]);
const HANDOVER_OVERRIDE = new Set(["MANAGEMENT"]);

export function canManageReadiness(user) {
  return isSuperAdmin(user) || SITE_MANAGE.has(user?.role?.code);
}
export function canManageSnag(user) {
  return isSuperAdmin(user) || QA_MANAGE.has(user?.role?.code);
}
export function canVerifySnag(user) {
  return isSuperAdmin(user) || QA_VERIFY.has(user?.role?.code);
}
export function canManageHandover(user) {
  return isSuperAdmin(user) || HANDOVER_MANAGE.has(user?.role?.code);
}
export function canOverrideHandover(user) {
  return isSuperAdmin(user) || HANDOVER_OVERRIDE.has(user?.role?.code);
}
