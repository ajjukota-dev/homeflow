import { randomUUID } from "node:crypto";
import { db } from "./db";
import { withTx, type DbLike } from "./events";
import { requireRole, STAFF_ROLES } from "./authz/requireRole";
import { AppError, type Ctx } from "./authz/types";

// 19-collections-true-risk.md Screens: "Studio: Payment plans" — bespoke, not the generic
// /studio/:table envelope (studio/core.ts's TABLE_REGISTRY assumes one row per primaryKey; a
// plan is a parent (payment_plan) plus an ordered list of child payment_plan_milestone rows,
// which a flat-column form can't represent). Neither table carries version/effective_from
// columns (unlike sla_policy/risk_rule), so this is plain CRUD, not the draft+publish pattern
// the rest of Policy Studio uses. `demand` rows copy milestone_key/label/trigger_event/sequence
// at generation time (demands-schedule.ts) rather than FK to payment_plan_milestone.id, so
// replacing a plan's whole milestone list on every save is safe — no dangling reference, no
// existing demand affected. Spec 19's own Data row for payment_plan says kind/milestones jsonb/
// versioning "stay future work" — so this deliberately has no draft/history trail, unlike every
// other Studio-editable config table. A save takes effect immediately for future demand
// generation on that plan; already-generated demand rows are untouched (see above).

const PAYMENT_PLAN_WRITE_ROLES = ["ACCOUNTS", "SUPER_ADMIN"];

export interface PaymentPlanMilestoneInput {
  milestone_key: string;
  milestone_label: string;
  construction_trigger_event: string | null;
  sequence: number;
  pct_of_consideration: number;
}

export interface PaymentPlanMilestone extends PaymentPlanMilestoneInput {
  id: string;
}

export interface PaymentPlan {
  id: string;
  project_id: string | null;
  name: string;
  basis: string;
  milestones: PaymentPlanMilestone[];
}

function validateMilestones(milestones: PaymentPlanMilestoneInput[]): void {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    throw new AppError("validation", "at least one milestone is required", "milestones");
  }
  const seenKeys = new Set<string>();
  const seenSequences = new Set<number>();
  for (const m of milestones) {
    if (!m.milestone_key?.trim()) throw new AppError("validation", "milestone_key is required", "milestones");
    const key = m.milestone_key.trim();
    if (seenKeys.has(key)) throw new AppError("validation", `duplicate milestone_key: ${key}`, "milestones");
    seenKeys.add(key);
    if (!m.milestone_label?.trim()) throw new AppError("validation", "milestone_label is required", "milestones");
    if (!Number.isInteger(m.sequence) || m.sequence < 1) throw new AppError("validation", "sequence must be a positive integer", "milestones");
    if (seenSequences.has(m.sequence)) throw new AppError("validation", `duplicate sequence: ${m.sequence}`, "milestones");
    seenSequences.add(m.sequence);
    if (!Number.isFinite(m.pct_of_consideration) || m.pct_of_consideration <= 0) {
      throw new AppError("validation", "pct_of_consideration must be a positive number", "milestones");
    }
  }
}

async function loadPlan(id: string): Promise<PaymentPlan> {
  const plan = await db.query<{ id: string; project_id: string | null; name: string; basis: string }>(
    `SELECT id, project_id, name, basis FROM payment_plan WHERE id = $1`,
    [id]
  );
  if (!plan.rows[0]) throw new AppError("not_found", "payment plan not found");
  const milestones = await db.query<PaymentPlanMilestone>(
    `SELECT id, milestone_key, milestone_label, construction_trigger_event, sequence, pct_of_consideration::float8 AS pct_of_consideration
       FROM payment_plan_milestone WHERE plan_id = $1 ORDER BY sequence`,
    [id]
  );
  return { ...plan.rows[0], milestones: milestones.rows };
}

export async function listPaymentPlans(ctx: Ctx): Promise<PaymentPlan[]> {
  requireRole(ctx, STAFF_ROLES);
  const plans = await db.query<{ id: string }>(`SELECT id FROM payment_plan ORDER BY id`);
  return Promise.all(plans.rows.map((p) => loadPlan(p.id)));
}

export async function getPaymentPlan(id: string, ctx: Ctx): Promise<PaymentPlan> {
  requireRole(ctx, STAFF_ROLES);
  return loadPlan(id);
}

async function writeMilestones(tx: DbLike, planId: string, milestones: PaymentPlanMilestoneInput[]) {
  await tx.query(`DELETE FROM payment_plan_milestone WHERE plan_id = $1`, [planId]);
  for (const m of milestones) {
    await tx.query(
      `INSERT INTO payment_plan_milestone (id, plan_id, milestone_key, milestone_label, construction_trigger_event, sequence, pct_of_consideration)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`${planId}_${m.milestone_key}`, planId, m.milestone_key.trim(), m.milestone_label.trim(), m.construction_trigger_event ?? null, m.sequence, m.pct_of_consideration]
    );
  }
}

export async function createPaymentPlan(
  input: { project_id: string | null; name: string; basis: string; milestones: PaymentPlanMilestoneInput[] },
  ctx: Ctx
): Promise<PaymentPlan> {
  requireRole(ctx, PAYMENT_PLAN_WRITE_ROLES);
  if (!input.name?.trim()) throw new AppError("validation", "name is required", "name");
  if (!input.basis?.trim()) throw new AppError("validation", "basis is required", "basis");
  validateMilestones(input.milestones);
  const id = "plan_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    await tx.query(`INSERT INTO payment_plan (id, project_id, name, basis) VALUES ($1,$2,$3,$4)`, [
      id,
      input.project_id ?? null,
      input.name.trim(),
      input.basis.trim(),
    ]);
    await writeMilestones(tx, id, input.milestones);
  });
  return loadPlan(id);
}

export async function updatePaymentPlan(
  id: string,
  input: { project_id: string | null; name: string; basis: string; milestones: PaymentPlanMilestoneInput[] },
  ctx: Ctx
): Promise<PaymentPlan> {
  requireRole(ctx, PAYMENT_PLAN_WRITE_ROLES);
  await loadPlan(id); // 404s if missing, before opening the write tx
  if (!input.name?.trim()) throw new AppError("validation", "name is required", "name");
  if (!input.basis?.trim()) throw new AppError("validation", "basis is required", "basis");
  validateMilestones(input.milestones);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE payment_plan SET project_id = $1, name = $2, basis = $3 WHERE id = $4`, [
      input.project_id ?? null,
      input.name.trim(),
      input.basis.trim(),
      id,
    ]);
    await writeMilestones(tx, id, input.milestones);
  });
  return loadPlan(id);
}
