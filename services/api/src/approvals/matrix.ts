import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, type DbLike } from "../events";
import { requireRole, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";

// Approval authority matrix (25-policy-studio.md rule 2) — the single "who approves this
// exception" lookup for every spec that needs it (17 discount/brokerage, 18 CR value/margin/
// schedule/freeze, 19 waivers, 22 deviations, 16 gate overrides, 24 holds, 06 plan revisions).
// None of those specs are built yet, so this ships with no consumers and no seeded rows — a
// band's min/max/approver_role is real business policy Amarsh has to set via the matrix editor,
// not something to invent to make an empty table look populated (CLAUDE.md "never hard-code").
//
// requiredApprovers() returns roles only. "The requester can never be an approver" (rule 2) is
// an identity check the CALLER makes against its own submitter/owner field — 10's approveAction
// already does exactly this keyed on action.submitted_by. Duplicating that check here, keyed on
// a different field, would just be a second guard that can drift out of sync with the first.

export type ApprovalDomain =
  | "DISCOUNT" | "BROKERAGE" | "WAIVER" | "CHANGE_REQUEST" | "COMMITMENT"
  | "DOCUMENT_DEVIATION" | "GATE_OVERRIDE" | "HOLD" | "PLAN_REVISION";
export type ApprovalMetric = "INR" | "PCT" | "DAYS" | "BOOL";

export interface ApprovalAuthorityRuleInput {
  domain: ApprovalDomain;
  metric: ApprovalMetric;
  min: number | null;
  max: number | null;
  approver_role: string;
  second_approver_role?: string | null;
  project_id?: string | null;
  product_types?: string[] | null; // rule 5: NULL = applies to every product type
  effective_from: string;
  effective_to?: string | null;
}

interface RuleRow {
  id: string; min: number | null; max: number | null;
  approver_role: string; second_approver_role: string | null;
  project_id: string | null; effective_from: string; effective_to: string | null;
}

interface ListedRuleRow extends RuleRow {
  domain: ApprovalDomain; metric: ApprovalMetric; version: number; product_types: string[] | null;
}

function rangesOverlap(aMin: number | null, aMax: number | null, bMin: number | null, bMax: number | null): boolean {
  const lo1 = aMin ?? -Infinity, hi1 = aMax ?? Infinity;
  const lo2 = bMin ?? -Infinity, hi2 = bMax ?? Infinity;
  return lo1 < hi2 && lo2 < hi1; // half-open [min, max) intervals
}

function datesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  const aEnd = aTo ?? "9999-12-31", bEnd = bTo ?? "9999-12-31";
  return aFrom < bEnd && bFrom < aEnd;
}

/** Publish-time guard (rule from advisor review, not in the spec text): reject a new/edited band
 *  that overlaps another band in the same (domain, metric, project scope) — an overlap would make
 *  requiredApprovers()'s band pick ambiguous. Scope is exact: a project-specific rule only
 *  conflicts with other rules for that same project_id, a global rule (project_id NULL) only
 *  with other global rules — a project override is allowed to overlap a global band's range,
 *  that's the point of the override. */
async function assertNoOverlap(input: ApprovalAuthorityRuleInput, excludeId: string | null, tx: DbLike): Promise<void> {
  const existing = await tx.query<RuleRow>(
    `SELECT id, min, max, approver_role, second_approver_role, project_id, effective_from::text, effective_to::text
       FROM approval_authority_rule
      WHERE domain = $1 AND metric = $2 AND project_id IS NOT DISTINCT FROM $3 AND id IS DISTINCT FROM $4`,
    [input.domain, input.metric, input.project_id ?? null, excludeId]
  );
  for (const r of existing.rows) {
    if (rangesOverlap(input.min, input.max, r.min, r.max) && datesOverlap(input.effective_from, input.effective_to ?? null, r.effective_from, r.effective_to)) {
      throw new AppError("conflict", `overlaps existing approval_authority_rule ${r.id} for ${input.domain}/${input.metric}`);
    }
  }
}

export async function createApprovalRule(input: ApprovalAuthorityRuleInput, ctx: Ctx): Promise<string> {
  requireRole(ctx, POLICY_STUDIO_ROLES); // rule 3: MANAGEMENT edits business policy (the matrix)
  return withTx(undefined, async (tx) => {
    await assertNoOverlap(input, null, tx);
    const id = "aar_" + randomUUID().slice(0, 8);
    await tx.query(
      `INSERT INTO approval_authority_rule
        (id, domain, metric, min, max, approver_role, second_approver_role, project_id, product_types, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11)`,
      [id, input.domain, input.metric, input.min, input.max, input.approver_role, input.second_approver_role ?? null, input.project_id ?? null, input.product_types ?? null, input.effective_from, input.effective_to ?? null]
    );
    await appendEvent(tx, {
      type: "policy.changed",
      entity_type: "approval_authority_rule",
      entity_id: id,
      project_id: input.project_id ?? null,
      actor_user_id: ctx.actor.user_id,
      payload: { table_name: "approval_authority_rule", domain: input.domain, metric: input.metric },
    });
    return id;
  });
}

export async function listApprovalRules(ctx: Ctx): Promise<ListedRuleRow[]> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  const r = await db.query<ListedRuleRow>(
    `SELECT id, domain, metric, min, max, approver_role, second_approver_role, project_id, product_types, effective_from::text, effective_to::text, version
       FROM approval_authority_rule ORDER BY domain, metric, project_id NULLS FIRST, min NULLS FIRST`
  );
  return r.rows;
}

export interface ApproverResult { approver_role: string; second_approver_role: string | null; rule_id: string }

/** The one lookup function every consuming spec calls. Prefers a project-specific band over a
 *  global one when both cover the value; fails CLOSED (throws) rather than returning "no
 *  approver needed" when no band covers the value — a gap in the matrix means the exception is
 *  blocked until Policy Studio configures a band for it, not silently auto-approved. */
// Signature matches rule 2's spec text exactly: requiredApprovers(domain, metric_value, project).
// product_types[] (rule 5) is stored per rule so a consuming spec CAN filter its own candidate set
// by product before calling this, but it isn't a lookup dimension here — no consumer exists yet
// to say whether a PLOT-only band should be invisible or just lower-priority to an APARTMENT call.
export async function requiredApprovers(domain: ApprovalDomain, metric: ApprovalMetric, value: number, projectId: string | null, tx: DbLike = db): Promise<ApproverResult> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await tx.query<RuleRow>(
    `SELECT id, min, max, approver_role, second_approver_role, project_id, effective_from::text, effective_to::text
       FROM approval_authority_rule
      WHERE domain = $1 AND metric = $2 AND (project_id = $3 OR project_id IS NULL)
        AND effective_from <= $4 AND (effective_to IS NULL OR effective_to > $4)`,
    [domain, metric, projectId, today]
  );
  const candidates = rows.rows.filter((r) => {
    const lo = r.min ?? -Infinity, hi = r.max ?? Infinity;
    return value >= lo && value < hi;
  });
  if (candidates.length === 0) {
    throw new AppError("conflict", `no approval_authority_rule covers ${domain}/${metric}=${value} — configure a band in Policy Studio before this can proceed`);
  }
  const projectSpecific = candidates.find((r) => r.project_id === projectId);
  const chosen = projectSpecific ?? candidates[0];
  return { approver_role: chosen.approver_role, second_approver_role: chosen.second_approver_role, rule_id: chosen.id };
}
