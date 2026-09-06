import { AppError, type Ctx } from "./types";

// R0.6 finding: ~15 routes are pre-booking master-data setup (project/unit/hierarchy
// creation, sales-inventory browsing, booking-lifecycle admin) that predate the
// 31-module customer-file permission_matrix and don't map onto it (no module can
// express "create a project" without inventing policy the matrix never covered).
// Amarsh's decision (2026-09-05): role-gate these directly with a per-route allow-list
// rather than extending the matrix or leaving them unauthorized.
export function requireRole(ctx: Ctx, allowedRoles: string[]): void {
  if (!ctx.actor.roles.some((r) => allowedRoles.includes(r))) {
    throw new AppError("forbidden", `requires one of: ${allowedRoles.join(", ")}`);
  }
}

// Any authenticated staff member — used for read-only master-data browsing
// (sales inventory, project lists) that carries no financial/PII exposure.
export const STAFF_ROLES = [
  "SALES", "CRM", "ACCOUNTS", "BANKING", "LEGAL", "REGISTRATION",
  "SITE", "QA", "CUSTOMISATION", "FM", "MANAGEMENT", "SUPER_ADMIN",
];

// Project/unit/hierarchy setup — site & management infrastructure work.
export const SITE_SETUP_ROLES = ["SITE", "MANAGEMENT", "SUPER_ADMIN"];

// Booking-lifecycle admin (confirm/cancel/transfer) beyond the sales_handover
// submit/accept/return steps the matrix already governs.
export const BOOKING_ADMIN_ROLES = ["SALES", "CRM", "MANAGEMENT", "SUPER_ADMIN"];

// Journey Template Studio / Policy Studio (05-journey-templates.md, 25-policy-studio.md
// rule 3): "SUPER_ADMIN edits everything; MANAGEMENT edits business policy" — no dedicated
// permission_matrix module exists for this (it predates 05, same gap class as above).
export const POLICY_STUDIO_ROLES = ["MANAGEMENT", "SUPER_ADMIN"];

// Cash-flow forecast (20-cash-forecast.md) — no "forecast"/"cash_flow" permission_matrix module
// exists in the seeded 32-module list (§1.3 verbatim); same gap class as the rows above. Read
// access follows p31 §26 ("Management can view...") plus the finance roles that already read
// collections/loans (ACCOUNTS, BANKING); write (scenarios, cash targets, probability rules,
// manual overrides) follows rule 1's own literal "requires role Accounts lead" — modeled as the
// ACCOUNTS role directly, same simplification this codebase already applies elsewhere for named
// seniority ("Accounts lead", "Dept head") that has no dedicated role value anywhere in the schema.
export const FORECAST_READ_ROLES = ["ACCOUNTS", "BANKING", "MANAGEMENT", "SUPER_ADMIN"];
export const FORECAST_WRITE_ROLES = ["ACCOUNTS", "MANAGEMENT", "SUPER_ADMIN"];
