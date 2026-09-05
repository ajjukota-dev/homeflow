import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { todayIst } from "../authz/clock";
import { loadHoldPolicy } from "./policy";

// 24-sales-inventory-discovery.md rule 6 — Change Window Hold: time-bound, Project-approved,
// auto-expiring. While APPROVED, 08's evaluateUnit refuses to move that unit/category's gate to a
// more closed state (changeability/core.ts reads `activeHoldsForUnit`), and 07's bulk preview
// marks the unit `held` (progress/core.ts). Expiry is derived on read + by `scanHolds`.

const REQUEST_ROLES = ["SALES", "MANAGEMENT", "SUPER_ADMIN"];

export interface HoldRow {
  id: string; code: string; unit_id: string; project_id: string; category_code: string; prospect_id: string | null; booking_id: string | null;
  requested_by: string; reason: string; requested_until: string; approved_by: string | null; approved_until: string | null; decision_note: string | null;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "EXPIRED" | "RELEASED" | "CONSUMED"; policy_id: string | null; created_at: string; closed_at: string | null;
}
const SELECT = `SELECT id, code, unit_id, project_id, category_code, prospect_id, booking_id, requested_by, reason, requested_until::text AS requested_until,
  approved_by, approved_until::text AS approved_until, decision_note, status, policy_id, created_at::text AS created_at, closed_at::text AS closed_at FROM change_window_hold`;

async function loadHold(id: string, tx: DbLike = db): Promise<HoldRow> {
  const r = await tx.query<HoldRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "hold not found");
  return r.rows[0];
}

async function expireHolds(tx: DbLike, asOf: string, unitId?: string): Promise<string[]> {
  const r = await tx.query<{ id: string; unit_id: string; project_id: string; category_code: string }>(
    `UPDATE change_window_hold SET status = 'EXPIRED', closed_at = now()
      WHERE status = 'APPROVED' AND approved_until < $1::date ${unitId ? "AND unit_id = $2" : ""}
      RETURNING id, unit_id, project_id, category_code`,
    unitId ? [asOf, unitId] : [asOf]
  );
  for (const h of r.rows) {
    await appendEvent(tx, { type: "hold.expired", entity_type: "change_window_hold", entity_id: h.id, project_id: h.project_id, unit_id: h.unit_id, payload: { category_code: h.category_code, approved_until: asOf } });
  }
  return r.rows.map((h) => h.id);
}

/** Read-side contract for 07/08: APPROVED, unexpired holds on a unit (expiry applied first). */
export async function activeHoldsForUnit(unitId: string, tx: DbLike = db, asOf: string = todayIst()): Promise<HoldRow[]> {
  const policyAutoExpire = (await tx.query<{ auto_expire: boolean }>(`SELECT auto_expire FROM hold_policy ORDER BY (project_id IS NULL) ASC LIMIT 1`)).rows[0]?.auto_expire ?? true;
  if (policyAutoExpire) await expireHolds(tx, asOf, unitId);
  return (await tx.query<HoldRow>(`${SELECT} WHERE unit_id = $1 AND status = 'APPROVED' ORDER BY approved_until`, [unitId])).rows;
}

export async function requestHold(
  input: { unit_id: string; category_code: string; prospect_id?: string | null; reason: string; requested_until: string },
  ctx: Ctx
): Promise<HoldRow> {
  requireRole(ctx, REQUEST_ROLES);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  if (!input.requested_until) throw new AppError("validation", "requested_until is required", "requested_until");
  const unit = (await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = $1`, [input.unit_id])).rows[0];
  if (!unit) throw new AppError("not_found", "unit not found");
  const cat = await db.query<{ code: string }>(`SELECT code FROM change_category WHERE code = $1`, [input.category_code]);
  if (!cat.rows[0]) throw new AppError("validation", `unknown category ${input.category_code}`, "category_code");
  const policy = await loadHoldPolicy(unit.project_id);
  if (policy.allowed_categories && !policy.allowed_categories.includes(input.category_code)) {
    throw new AppError("validation", `hold policy does not allow holds on ${input.category_code}`, "category_code");
  }
  const days = (Date.parse(input.requested_until) - Date.parse(todayIst())) / (24 * 60 * 60 * 1000);
  if (days <= 0) throw new AppError("validation", "requested_until must be in the future", "requested_until");
  if (days > policy.max_days) throw new AppError("validation", `hold policy allows at most ${policy.max_days} days`, "requested_until");
  const active = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM change_window_hold WHERE project_id = $1 AND status IN ('REQUESTED', 'APPROVED')`, [unit.project_id]);
  if ((active.rows[0]?.n ?? 0) >= policy.max_active_per_project) throw new AppError("conflict", `hold policy allows at most ${policy.max_active_per_project} active holds per project`);
  const dup = await db.query<{ id: string }>(`SELECT id FROM change_window_hold WHERE unit_id = $1 AND category_code = $2 AND status IN ('REQUESTED', 'APPROVED')`, [input.unit_id, input.category_code]);
  if (dup.rows[0]) throw new AppError("conflict", `an active hold already exists on ${input.category_code} for this unit`);

  const id = "hold_" + randomUUID().slice(0, 8);
  await withTx(undefined, async (tx) => {
    const code = await nextCode(tx, "HLD");
    await tx.query(
      `INSERT INTO change_window_hold (id, code, unit_id, project_id, category_code, prospect_id, requested_by, reason, requested_until, policy_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, code, input.unit_id, unit.project_id, input.category_code, input.prospect_id ?? null, ctx.actor.user_id, input.reason.trim(), input.requested_until, policy.id]
    );
    await appendEvent(tx, { type: "hold.requested", entity_type: "change_window_hold", entity_id: id, project_id: unit.project_id, unit_id: input.unit_id, payload: { code, category_code: input.category_code, requested_until: input.requested_until, prospect_id: input.prospect_id ?? null }, ...actorFields(ctx) });
  });
  return loadHold(id);
}

async function decide(id: string, to: "APPROVED" | "REJECTED", input: { approved_until?: string; note?: string }, ctx: Ctx): Promise<HoldRow> {
  requireRole(ctx, STAFF_ROLES);
  const h = await loadHold(id);
  const policy = await loadHoldPolicy(h.project_id);
  if (!ctx.actor.roles.includes(policy.approver_role) && !ctx.actor.roles.includes("SUPER_ADMIN")) throw new AppError("forbidden", `hold decisions require the ${policy.approver_role} role`);
  if (h.status !== "REQUESTED") throw new AppError("conflict", `hold is ${h.status}`);
  const until = input.approved_until ?? h.requested_until;
  if (to === "APPROVED" && until > h.requested_until) throw new AppError("validation", "approved_until cannot exceed the requested date", "approved_until");
  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE change_window_hold SET status = $2, approved_by = $3, approved_until = $4, decision_note = $5, closed_at = CASE WHEN $2 = 'REJECTED' THEN now() ELSE NULL END WHERE id = $1`,
      [id, to, ctx.actor.user_id, to === "APPROVED" ? until : null, input.note ?? null]
    );
    await appendEvent(tx, { type: to === "APPROVED" ? "hold.approved" : "hold.rejected", entity_type: "change_window_hold", entity_id: id, project_id: h.project_id, unit_id: h.unit_id, payload: { code: h.code, category_code: h.category_code, approved_until: to === "APPROVED" ? until : null, note: input.note ?? null }, ...actorFields(ctx) });
  });
  return loadHold(id);
}

export const approveHold = (id: string, input: { approved_until?: string; note?: string }, ctx: Ctx) => decide(id, "APPROVED", input, ctx);
export const rejectHold = (id: string, note: string | undefined, ctx: Ctx) => decide(id, "REJECTED", { note }, ctx);

export async function releaseHold(id: string, reason: string, ctx: Ctx): Promise<HoldRow> {
  requireRole(ctx, REQUEST_ROLES);
  if (!reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  const h = await loadHold(id);
  if (h.status !== "APPROVED" && h.status !== "REQUESTED") throw new AppError("conflict", `hold is ${h.status}`);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_window_hold SET status = 'RELEASED', decision_note = $2, closed_at = now() WHERE id = $1`, [id, reason.trim()]);
    await appendEvent(tx, { type: "hold.released", entity_type: "change_window_hold", entity_id: id, project_id: h.project_id, unit_id: h.unit_id, payload: { code: h.code, category_code: h.category_code, reason: reason.trim() }, ...actorFields(ctx) });
  });
  return loadHold(id);
}

/** Rule 6 CONSUMED: the prospect books the unit (rule 8) — every APPROVED hold they held on it closes. */
export async function consumeHoldsForBooking(prospectId: string, unitId: string, bookingId: string, tx: DbLike): Promise<string[]> {
  const r = await tx.query<{ id: string; project_id: string; category_code: string; code: string }>(
    `UPDATE change_window_hold SET status = 'CONSUMED', booking_id = $3, closed_at = now()
      WHERE prospect_id = $1 AND unit_id = $2 AND status IN ('APPROVED', 'REQUESTED') RETURNING id, project_id, category_code, code`,
    [prospectId, unitId, bookingId]
  );
  for (const h of r.rows) {
    await appendEvent(tx, { type: "hold.consumed", entity_type: "change_window_hold", entity_id: h.id, project_id: h.project_id, unit_id: unitId, booking_id: bookingId, payload: { code: h.code, category_code: h.category_code } });
  }
  return r.rows.map((h) => h.id);
}

export async function listHolds(projectId: string, status: string | undefined, ctx: Ctx): Promise<HoldRow[]> {
  requireRole(ctx, STAFF_ROLES);
  await withTx(undefined, (tx) => expireHolds(tx, todayIst()));
  return (await db.query<HoldRow>(`${SELECT} WHERE project_id = $1 ${status ? "AND status = $2" : ""} ORDER BY created_at DESC`, status ? [projectId, status.toUpperCase()] : [projectId])).rows;
}

/** Rule 6's nightly expiry — callable with a controlled asOf (no scheduler exists). */
export async function scanHolds(asOf: string = todayIst()): Promise<{ expired: string[] }> {
  const expired = await withTx(undefined, (tx) => expireHolds(tx, asOf));
  return { expired };
}
