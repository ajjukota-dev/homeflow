import { db } from "../db";
import { requireRole, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { loadPolicy } from "./store";

// Policy Studio "Customisation policy" tab — freeze dates, quotation validity, payment gate %,
// cancellation terms, catalogue-only flag.

export async function getCustomisationPolicy(projectId: string, ctx: Ctx) {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  return loadPolicy(projectId, db);
}

export interface PolicyInput { freeze_dates?: Record<string, string>; quotation_validity_days?: number; payment_gate_pct?: number; cancellation_terms?: Record<string, unknown>; allowed_catalogue_only?: boolean }

export async function putCustomisationPolicy(projectId: string, input: PolicyInput, ctx: Ctx) {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  if (input.payment_gate_pct !== undefined && (input.payment_gate_pct < 0 || input.payment_gate_pct > 100)) {
    throw new AppError("validation", "payment_gate_pct must be between 0 and 100", "payment_gate_pct");
  }
  if (input.quotation_validity_days !== undefined && input.quotation_validity_days <= 0) {
    throw new AppError("validation", "quotation_validity_days must be positive", "quotation_validity_days");
  }
  const current = await loadPolicy(projectId, db);
  await db.query(
    `INSERT INTO customisation_policy (project_id, freeze_dates, quotation_validity_days, payment_gate_pct, cancellation_terms, allowed_catalogue_only)
     VALUES ($1,$2::jsonb,$3,$4,$5::jsonb,$6)
     ON CONFLICT (project_id) DO UPDATE SET freeze_dates = $2::jsonb, quotation_validity_days = $3, payment_gate_pct = $4, cancellation_terms = $5::jsonb, allowed_catalogue_only = $6`,
    [projectId, JSON.stringify(input.freeze_dates ?? current.freeze_dates), input.quotation_validity_days ?? current.quotation_validity_days,
      input.payment_gate_pct ?? current.payment_gate_pct, JSON.stringify(input.cancellation_terms ?? current.cancellation_terms), input.allowed_catalogue_only ?? current.allowed_catalogue_only]
  );
  return loadPolicy(projectId, db);
}
