import { randomUUID } from "node:crypto";
import { db } from "./db";
import { DEMAND_SELECT, mapDemands } from "./demands";
import { type DemandStatus } from "./collections";
import { appendEvent, withTx } from "./events";
import { authorize } from "./authz/authorize";
import type { Ctx } from "./authz/types";

// Receipt posting — idempotent payment capture against a demand (accounts/spec.md H3 receipts).

export type ReceiptRow = {
  id: string; booking_id: string; project_id: string; demand_id: string; amount: string;
  mode: string; received_at: Date; tds_amount: string; status: string;
  idempotency_key: string | null; request_hash: string | null;
};

export async function postReceipt(
  demandId: string,
  input: { amount?: number | string; mode?: string; idempotency_key?: string },
  ctx: Ctx
) {
  await authorize(ctx, "collections", "WRITE");
  const amount = typeof input.amount === "string" ? Number(input.amount) : input.amount;
  const key = input.idempotency_key ?? randomUUID();
  const hash = JSON.stringify({ amount, mode: input.mode ?? "neft" });
  const existing = await db.query<{ id: string; request_hash: string }>(
    `SELECT id, request_hash FROM receipt WHERE idempotency_key = $1`,
    [key]
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].request_hash !== hash) throw new Error("idempotency_payload_mismatch");
    const r = await db.query<ReceiptRow>(`SELECT * FROM receipt WHERE id = $1`, [existing.rows[0].id]);
    return { ...r.rows[0], amount: Number(r.rows[0].amount) };
  }

  const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]))[0];
  if (!d) throw new Error("not_found");
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) throw new Error("invalid_amount");
  if (amount > d.remaining) throw new Error("exceeds_remaining");

  const id = randomUUID();
  const remaining = d.remaining - amount;
  const status: DemandStatus = remaining <= 0 ? "settled" : "part_paid";
  // Current flow reconciles at post time (no separate bank-statement matching step yet), so
  // payment.received and payment.reconciled (both Appendix B) fire together here.
  await withTx(undefined, async (t) => {
    await t.query(
      `INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, mode, status, idempotency_key, request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,'reconciled',$7,$8)`,
      [id, d.booking_id, d.project_id, demandId, amount, input.mode ?? "neft", key, hash]
    );
    await t.query(`UPDATE demand SET status = $1 WHERE id = $2`, [status, demandId]);
    await appendEvent(t, {
      type: "payment.received",
      entity_type: "receipt",
      entity_id: id,
      project_id: d.project_id,
      booking_id: d.booking_id,
      customer_id: null,
      payload: { demand_id: demandId, amount, mode: input.mode ?? "neft" },
    });
    await appendEvent(t, {
      type: "payment.reconciled",
      entity_type: "receipt",
      entity_id: id,
      project_id: d.project_id,
      booking_id: d.booking_id,
      payload: { demand_id: demandId, amount },
    });
  });
  const row = await db.query<ReceiptRow>(`SELECT * FROM receipt WHERE id = $1`, [id]);
  return { ...row.rows[0], amount, project_id: d.project_id };
}

// Rule 4 (19-collections-true-risk.md): "VERIFIED receipts count toward paid ... PENDING show as
// 'received, unverified'." Receipts are still recorded as VERIFIED at post time by default (the
// system has no separate bank-statement reconciliation step to make a genuine PENDING->VERIFIED
// step meaningful yet — same class of scope cut as 06/10's "flag, don't fake" for unbuilt
// infrastructure) — what these two functions give real behavior to is the DISPUTED path: a
// receipt later found to be wrong (bounced cheque, mis-posted entry) stops counting toward
// `remaining` (DEMAND_SELECT's remaining subquery excludes verification='DISPUTED') until it's
// verified again.

export async function disputeReceipt(receiptId: string, reason: string, ctx: Ctx): Promise<void> {
  await authorize(ctx, "collections", "WRITE");
  if (!reason?.trim()) throw new Error("reason_required");
  await withTx(undefined, async (tx) => {
    const r = await tx.query<{ demand_id: string; project_id: string; booking_id: string; verification: string }>(
      `SELECT demand_id, project_id, booking_id, verification FROM receipt WHERE id = $1`,
      [receiptId]
    );
    if (!r.rows[0]) throw new Error("not_found");
    if (r.rows[0].verification === "DISPUTED") throw new Error("already_disputed");
    await tx.query(`UPDATE receipt SET verification = 'DISPUTED', dispute_reason = $1 WHERE id = $2`, [reason, receiptId]);
    await appendEvent(tx, {
      type: "payment.disputed",
      entity_type: "receipt",
      entity_id: receiptId,
      project_id: r.rows[0].project_id,
      booking_id: r.rows[0].booking_id,
      payload: { demand_id: r.rows[0].demand_id, reason },
    });
  });
}

/** Marks a receipt VERIFIED — the entry point for both the (currently always-satisfied) initial
 *  verification and for re-including a receipt once a dispute is resolved. Idempotent. */
export async function verifyReceipt(receiptId: string, ctx: Ctx): Promise<void> {
  await authorize(ctx, "collections", "WRITE");
  await withTx(undefined, async (tx) => {
    const r = await tx.query<{ verification: string }>(`SELECT verification FROM receipt WHERE id = $1`, [receiptId]);
    if (!r.rows[0]) throw new Error("not_found");
    if (r.rows[0].verification === "VERIFIED") return;
    await tx.query(
      `UPDATE receipt SET verification = 'VERIFIED', verified_by = $1, verified_at = now(), dispute_reason = NULL WHERE id = $2`,
      [ctx.actor.user_id, receiptId]
    );
  });
}
