import { randomUUID } from "node:crypto";
import { db } from "./db";
import { appendEvent, withTx, actorFields, type DbLike } from "./events";
import { requiredApprovers } from "./approvals/matrix";
import { requireRole, STAFF_ROLES } from "./authz/requireRole";
import { AppError, type Ctx } from "./authz/types";
import { DEMAND_SELECT, mapDemands } from "./demands";

// Rule 8 (19-collections-true-risk.md): "Waivers require an APPROVAL action per matrix (25);
// approved waivers reduce outstanding and are counted as commercial leakage (27) with reason."
// 27 (profitability/leakage rollup) isn't built — this table carries everything a future 27
// needs (amount, reason, kind, demand_id) to query `waiver WHERE status = 'APPROVED'` itself;
// no rollup is computed here. "The requester can never be an approver" is enforced here (like
// 10's approveAction) keyed on `waiver.requested_by`, per 25's own note that this check belongs
// to the caller, not the matrix.
//
// This is the matrix's (25) first real consumer, and it ships with zero seeded
// approval_authority_rule rows by design — requestWaiver calls requiredApprovers("WAIVER", ...)
// at REQUEST time (not just at approval time) so a waiver can't even be requested until Policy
// Studio configures a WAIVER band; that's deliberate fail-closed behavior, not a bug to route
// around (25's own design note).

export type WaiverKind = "INTEREST" | "LATE_FEE" | "PRINCIPAL" | "OTHER_CHARGE";

export interface WaiverRow {
  id: string;
  booking_id: string;
  demand_id: string;
  kind: WaiverKind;
  amount: number;
  reason: string;
  requested_by: string;
  approved_by: string | null;
  approval_rule_id: string | null;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
}

async function requireWaiver(id: string, tx: DbLike): Promise<WaiverRow> {
  const r = await tx.query<WaiverRow>(
    `SELECT id, booking_id, demand_id, kind, amount::float8 AS amount, reason, requested_by, approved_by, approval_rule_id, status
       FROM waiver WHERE id = $1`,
    [id]
  );
  if (!r.rows[0]) throw new AppError("not_found", "waiver not found");
  return r.rows[0];
}

export async function requestWaiver(
  input: { booking_id: string; demand_id: string; kind: WaiverKind; amount: number; reason: string },
  ctx: Ctx
): Promise<WaiverRow> {
  requireRole(ctx, STAFF_ROLES);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new AppError("validation", "amount must be positive", "amount");

  return withTx(undefined, async (tx) => {
    const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [input.demand_id], tx))[0];
    if (!d) throw new AppError("not_found", "demand not found");
    if (input.amount > d.remaining) throw new AppError("validation", "waiver amount exceeds the demand's remaining balance", "amount");

    // Fails closed here (rule 2, 25) if no band covers this amount for this domain/project —
    // a waiver simply cannot be requested until Policy Studio configures one.
    const approver = await requiredApprovers("WAIVER", "INR", input.amount, d.project_id, tx);

    const id = "wvr_" + randomUUID().slice(0, 8);
    await tx.query(
      `INSERT INTO waiver (id, booking_id, demand_id, kind, amount, reason, requested_by, approval_rule_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, input.booking_id, input.demand_id, input.kind, input.amount, input.reason, ctx.actor.user_id, approver.rule_id]
    );
    await appendEvent(tx, {
      type: "waiver.requested",
      entity_type: "waiver",
      entity_id: id,
      project_id: d.project_id,
      booking_id: input.booking_id,
      payload: { demand_id: input.demand_id, amount: input.amount, kind: input.kind, approver_role: approver.approver_role },
      ...actorFields(ctx),
    });
    return requireWaiver(id, tx);
  });
}

export async function approveWaiver(id: string, ctx: Ctx): Promise<WaiverRow> {
  requireRole(ctx, STAFF_ROLES);
  return withTx(undefined, async (tx) => {
    const w = await requireWaiver(id, tx);
    if (w.status !== "REQUESTED") throw new AppError("conflict", `waiver already ${w.status}`);
    if (w.requested_by === ctx.actor.user_id) throw new AppError("forbidden", "the requester cannot approve their own waiver");

    const rule = await tx.query<{ approver_role: string }>(`SELECT approver_role FROM approval_authority_rule WHERE id = $1`, [w.approval_rule_id]);
    const isSA = ctx.actor.roles.includes("SUPER_ADMIN");
    if (!isSA && !(rule.rows[0] && ctx.actor.roles.includes(rule.rows[0].approver_role))) {
      throw new AppError("forbidden", `requires the ${rule.rows[0]?.approver_role ?? "configured"} role`);
    }

    await tx.query(`UPDATE waiver SET status = 'APPROVED', approved_by = $1, decided_at = now() WHERE id = $2`, [ctx.actor.user_id, id]);
    // Rule 8: "approved waivers reduce outstanding." demand.amount is left untouched (the
    // schedule must still sum to booking.total_consideration, per demands.test.ts's invariant) —
    // DEMAND_SELECT's `remaining` subtracts approved waivers directly, the same shape as the
    // dispute exclusion, so this waiver row is the durable record of why remaining shrank.
    await appendEvent(tx, {
      type: "waiver.approved",
      entity_type: "waiver",
      entity_id: id,
      booking_id: w.booking_id,
      payload: { demand_id: w.demand_id, amount: w.amount },
      ...actorFields(ctx),
    });
    return requireWaiver(id, tx);
  });
}

export async function rejectWaiver(id: string, reason: string, ctx: Ctx): Promise<WaiverRow> {
  requireRole(ctx, STAFF_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  return withTx(undefined, async (tx) => {
    const w = await requireWaiver(id, tx);
    if (w.status !== "REQUESTED") throw new AppError("conflict", `waiver already ${w.status}`);
    await tx.query(`UPDATE waiver SET status = 'REJECTED', approved_by = $1, decided_at = now() WHERE id = $2`, [ctx.actor.user_id, id]);
    // "waiver.rejected" isn't in the spec's Events list verbatim (it names only requested/
    // approved) but a REJECTED outcome recorded under the "approved" event name would be a
    // misleading audit trail — a real emitted-but-false status is worse than an unnamed one, so
    // this is a sanctioned extension, same class as 05/06's own additions past their spec text.
    await appendEvent(tx, {
      type: "waiver.rejected",
      entity_type: "waiver",
      entity_id: id,
      booking_id: w.booking_id,
      payload: { reason },
      ...actorFields(ctx),
    });
    return requireWaiver(id, tx);
  });
}

export async function listWaivers(bookingId: string, ctx: Ctx): Promise<WaiverRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<WaiverRow>(
    `SELECT id, booking_id, demand_id, kind, amount::float8 AS amount, reason, requested_by, approved_by, approval_rule_id, status
       FROM waiver WHERE booking_id = $1 ORDER BY created_at DESC`,
    [bookingId]
  );
  return r.rows;
}
