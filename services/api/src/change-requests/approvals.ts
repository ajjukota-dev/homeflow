import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { createAction, approveAction, rejectAction } from "../actions/core";
import { loadCr, listCrItems, type CrRow } from "./store";
import { lineTotal } from "./costing";
import { CUSTOMISATION_DESK_ROLES } from "./capture";

// 18 rule 4 — its own `cr_approval_rule` (Policy Studio "variation approval matrix"), not
// 25's generic `approval_authority_rule`: the spec gives this feature its own dedicated table in
// the Data section, same "own bespoke versioning, stays outside the generic envelope" call 25's
// build made for 05/06's tables.

export interface RuleInput {
  kind: "VALUE" | "MARGIN" | "SCHEDULE" | "FREEZE" | "CATEGORY";
  category_code?: string | null;
  threshold?: number | null;
  approver_role: string;
  requires_second_approver?: boolean;
  second_approver_role?: string | null;
  effective_from?: string;
  effective_to?: string | null;
}
export interface RuleRow extends Required<Omit<RuleInput, "effective_to">> { id: string; project_id: string | null; effective_to: string | null }
const RULE_SELECT = `SELECT id, project_id, kind, category_code, threshold::float8 AS threshold, approver_role, requires_second_approver, second_approver_role,
  effective_from::text AS effective_from, effective_to::text AS effective_to FROM cr_approval_rule`;

export async function listApprovalRules(filter: { project_id?: string | null }, ctx: Ctx): Promise<RuleRow[]> {
  requireRole(ctx, [...CUSTOMISATION_DESK_ROLES, ...POLICY_STUDIO_ROLES]);
  const conds: string[] = []; const params: unknown[] = [];
  if (filter.project_id !== undefined) {
    if (filter.project_id === null) conds.push("project_id IS NULL");
    else { params.push(filter.project_id); conds.push(`project_id = $${params.length}`); }
  }
  const r = await db.query<RuleRow>(`${RULE_SELECT} ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY project_id NULLS FIRST, kind`, params);
  return r.rows;
}

/** PUT: replace the full rule set for one scope (standard or a project) — Policy Studio's matrix editor. */
export async function putApprovalRules(scope: { project_id?: string | null }, rules: RuleInput[], ctx: Ctx): Promise<RuleRow[]> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  const projectId = scope.project_id ?? null;
  if (!Array.isArray(rules)) throw new AppError("validation", "rules must be a list", "rules");
  return withTx(undefined, async (tx) => {
    await tx.query(`DELETE FROM cr_approval_rule WHERE COALESCE(project_id, '') = COALESCE($1, '')`, [projectId]);
    const ids: string[] = [];
    for (const r of rules) {
      if (!r.approver_role) throw new AppError("validation", "approver_role is required", "rules");
      if (r.kind === "CATEGORY" && !r.category_code) throw new AppError("validation", "category_code is required for a CATEGORY rule", "rules");
      const id = "crar_" + randomUUID().slice(0, 8);
      await tx.query(
        `INSERT INTO cr_approval_rule (id, project_id, kind, category_code, threshold, approver_role, requires_second_approver, second_approver_role, effective_from, effective_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, projectId, r.kind, r.category_code ?? null, r.threshold ?? null, r.approver_role, r.requires_second_approver ?? false,
          r.second_approver_role ?? null, r.effective_from ?? new Date().toISOString().slice(0, 10), r.effective_to ?? null]
      );
      ids.push(id);
    }
    return (await tx.query<RuleRow>(`${RULE_SELECT} WHERE id = ANY($1::text[]) ORDER BY kind`, [ids])).rows;
  });
}

interface RequiredApprover { role: string; kind: "VALUE" | "MARGIN" | "SCHEDULE" | "FREEZE" | "SECOND_APPROVER" }

/** Rule 4: evaluate the published matrix against this CR's own economics/impact/freeze state. */
export async function evaluateRequiredApprovers(cr: CrRow, tx: DbLike): Promise<RequiredApprover[]> {
  const items = await listCrItems(cr.id, tx);
  const totalValue = items.reduce((s, it) => s + lineTotal(it), 0);
  const totalCost = items.reduce((s, it) => s + it.qty * it.vendor_cost_inr, 0);
  const marginPct = totalValue > 0 ? ((totalValue - totalCost) / totalValue) * 100 : 100;
  const scheduleDays = cr.impact?.schedule_days ?? 0;

  const rules = (await tx.query<RuleRow>(`${RULE_SELECT} WHERE (project_id IS NULL OR project_id = $1) AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`, [cr.project_id])).rows;
  const byKind = new Map<string, RuleRow>();
  for (const r of rules) {
    const key = r.kind === "CATEGORY" ? `CATEGORY:${r.category_code}` : r.kind;
    if (!byKind.has(key) || r.project_id) byKind.set(key, r); // project row overrides standard
  }

  const out: RequiredApprover[] = [];
  const value = byKind.get("VALUE");
  if (value && value.threshold !== null && totalValue > value.threshold) out.push({ role: value.approver_role, kind: "VALUE" });
  const margin = byKind.get("MARGIN");
  if (margin && margin.threshold !== null && marginPct < margin.threshold) out.push({ role: margin.approver_role, kind: "MARGIN" });
  const schedule = byKind.get("SCHEDULE");
  if (schedule && schedule.threshold !== null && scheduleDays > schedule.threshold) out.push({ role: schedule.approver_role, kind: "SCHEDULE" });
  const freeze = byKind.get("FREEZE");
  if (freeze && cr.freeze_state_at_request === "POST_FREEZE") {
    out.push({ role: freeze.approver_role, kind: "FREEZE" });
    if (freeze.requires_second_approver) out.push({ role: freeze.second_approver_role ?? freeze.approver_role, kind: "SECOND_APPROVER" });
  }
  for (const r of rules) {
    if (r.kind !== "CATEGORY") continue;
    if (items.some((it) => it.category_code === r.category_code)) out.push({ role: r.approver_role, kind: "VALUE" });
  }
  return out;
}

/** Rule 3->4 transition: COSTING -> AWAITING_APPROVAL (or straight to AWAITING_CUSTOMER when no
 *  approver is required by the published matrix). Rule 1's EXCEPTION_ONLY-before-COSTING guard
 *  is enforced here, at the point costing work is actually submitted onward. */
export async function submitCrForApproval(crId: string, ctx: Ctx): Promise<CrRow> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await loadCr(crId);
  if (cr.status !== "COSTING") throw new AppError("conflict", `change request is ${cr.status}, not COSTING`);
  if (!cr.impact) throw new AppError("validation", "impact assessment (all four dimensions) is required before submitting for approval");
  const items = await listCrItems(crId);
  if (items.length === 0) throw new AppError("validation", "at least one line item is required before submitting for approval");

  for (const it of items) {
    if (it.gate_state_at_request === "EXCEPTION_ONLY" && !cr.exception_id) {
      throw new AppError("conflict", `${it.category_code} is EXCEPTION_ONLY — grant a unit_gate_exception (08) for this unit before costing can proceed`);
    }
  }

  return withTx(undefined, async (tx) => {
    const required = await evaluateRequiredApprovers(cr, tx);
    if (required.length === 0) {
      await tx.query(`UPDATE change_request SET status = 'AWAITING_CUSTOMER', updated_at = now() WHERE id = $1`, [crId]);
      await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "COSTING", to: "AWAITING_CUSTOMER", approvers: [] }, ...actorFields(ctx) });
      return loadCr(crId, tx);
    }
    for (const req of required) {
      const actionId = await createAction({
        type: "exec_approval", title: `Approve ${cr.code}: ${req.kind.toLowerCase()} threshold`, project_id: cr.project_id,
        source_module: "change_requests", source_entity_type: "change_request", source_entity_id: crId,
        booking_id: cr.booking_id, unit_id: cr.unit_id, customer_id: cr.customer_id, owner_role: req.role, approver_role: req.role, origin: "AUTO",
      }, tx);
      await tx.query(
        `INSERT INTO change_request_approval (id, cr_id, action_id, approver_role, kind) VALUES ($1,$2,$3,$4,$5)`,
        ["cra_" + randomUUID().slice(0, 8), crId, actionId, req.role, req.kind]
      );
      // The generic action model starts at 'New'. This goes straight to 'Ready for Approval' via
      // direct SQL (not the ctx-gated submitForApproval, which opens its own withTx — nesting it
      // here would hang, same lesson as decideCrApproval below) and stamps submitted_by as the
      // CUSTOMISATION-desk submitter, not the eventual approver — that is what makes
      // approveAction's self-approve guard actually enforce "approver ≠ coster".
      await tx.query(`UPDATE action SET status = 'Ready for Approval', submitted_by = $2 WHERE id = $1`, [actionId, ctx.actor.user_id]);
    }
    await tx.query(`UPDATE change_request SET status = 'AWAITING_APPROVAL', updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "COSTING", to: "AWAITING_APPROVAL", approvers: required.map((r) => r.role) }, ...actorFields(ctx) });
    return loadCr(crId, tx);
  });
}

interface CraRow { id: string; cr_id: string; action_id: string; approver_role: string; decision: "PENDING" | "APPROVED" | "REJECTED"; decided_by: string | null }

/** Read side for the approvals panel — nothing exposed `change_request_approval` rows to a UI
 *  before now (same "write with no matching read" gap as the items/quotation GET routes). */
export async function listCrApprovals(crId: string): Promise<CraRow[]> {
  return (await db.query<CraRow>(`SELECT id, cr_id, action_id, approver_role, decision, decided_by FROM change_request_approval WHERE cr_id = $1 ORDER BY approver_role`, [crId])).rows;
}

/** Rule 4's "approver ≠ requester ≠ coster": the action-level self-approve guard already blocks
 *  the submitter; this additionally blocks the SAME person deciding two approvals on one CR
 *  (covers "second approver" genuinely being a different person). */
async function assertDistinctApprover(crId: string, userId: string, tx: DbLike): Promise<void> {
  const prior = await tx.query(`SELECT 1 FROM change_request_approval WHERE cr_id = $1 AND decision = 'APPROVED' AND decided_by = $2`, [crId, userId]);
  if (prior.rows.length > 0) throw new AppError("forbidden", "this person has already approved another approval on this change request");
}

async function loadCra(actionId: string, tx: DbLike): Promise<CraRow> {
  const r = await tx.query<CraRow>(`SELECT id, cr_id, action_id, approver_role, decision, decided_by FROM change_request_approval WHERE action_id = $1`, [actionId]);
  if (!r.rows[0]) throw new AppError("not_found", "approval not found");
  return r.rows[0];
}

async function checkAllDecided(crId: string, ctx: Ctx, tx: DbLike): Promise<void> {
  const rows = await tx.query<{ decision: string }>(`SELECT decision FROM change_request_approval WHERE cr_id = $1`, [crId]);
  if (rows.rows.some((r) => r.decision === "REJECTED")) {
    const cr = await loadCr(crId, tx);
    await tx.query(`UPDATE change_request SET status = 'REJECTED', updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "AWAITING_APPROVAL", to: "REJECTED" }, ...actorFields(ctx) });
    return;
  }
  if (rows.rows.every((r) => r.decision === "APPROVED")) {
    const cr = await loadCr(crId, tx);
    await tx.query(`UPDATE change_request SET status = 'AWAITING_CUSTOMER', updated_at = now() WHERE id = $1`, [crId]);
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "AWAITING_APPROVAL", to: "AWAITING_CUSTOMER" }, ...actorFields(ctx) });
  }
}

/** `approveAction`/`rejectAction` each open their own `withTx` — nesting either inside another
 *  open transaction hangs forever on this codebase's single-connection PGlite (the 17/22 lesson).
 *  Composed sequentially between transactions: each cross-module call below commits on its own
 *  before this function opens its own tx for its own bookkeeping. The action is already 'Ready
 *  for Approval' (submitCrForApproval stamped that directly) — no separate submit step here. */
export async function decideCrApproval(actionId: string, decision: "APPROVE" | "REJECT", note: string | undefined, ctx: Ctx): Promise<CrRow> {
  const cra = await loadCra(actionId, db);
  const cr = await loadCr(cra.cr_id);
  if (cr.status !== "AWAITING_APPROVAL") throw new AppError("conflict", `change request is ${cr.status}, not AWAITING_APPROVAL`);
  if (cr.raised_by_user_id === ctx.actor.user_id) throw new AppError("forbidden", "the requester cannot approve their own change request (approver ≠ requester)");

  if (decision === "APPROVE") {
    await assertDistinctApprover(cr.id, ctx.actor.user_id, db);
    await approveAction(actionId, note, ctx); // own tx (self-approve guard against the CR's own submitter)
    await withTx(undefined, async (tx) => {
      await tx.query(`UPDATE change_request_approval SET decision = 'APPROVED', decided_by = $2, decided_at = now() WHERE action_id = $1`, [actionId, ctx.actor.user_id]);
      await checkAllDecided(cr.id, ctx, tx);
    });
  } else {
    if (!note?.trim()) throw new AppError("validation", "a reason is required to reject", "note");
    await rejectAction(actionId, note, ctx); // own tx
    await withTx(undefined, async (tx) => {
      await tx.query(`UPDATE change_request_approval SET decision = 'REJECTED', decided_by = $2, decided_at = now() WHERE action_id = $1`, [actionId, ctx.actor.user_id]);
      await checkAllDecided(cr.id, ctx, tx);
    });
  }
  return loadCr(cr.id);
}
