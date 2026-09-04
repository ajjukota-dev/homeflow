import { randomUUID } from "node:crypto";
import { db } from "./db";
import { DEMAND_SELECT, mapDemands } from "./demands";
import { type DemandStatus } from "./collections";

// Receipt posting — idempotent payment capture against a demand (accounts/spec.md H3 receipts).

export type ReceiptRow = {
  id: string; booking_id: string; project_id: string; demand_id: string; amount: string;
  mode: string; received_at: Date; tds_amount: string; status: string;
  idempotency_key: string | null; request_hash: string | null;
};

export async function postReceipt(
  demandId: string,
  input: { amount: number; mode?: string; idempotency_key?: string }
) {
  const key = input.idempotency_key ?? randomUUID();
  const hash = JSON.stringify({ amount: input.amount, mode: input.mode ?? "neft" });
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
  if (input.amount <= 0) throw new Error("invalid_amount");
  if (input.amount > d.remaining) throw new Error("exceeds_remaining");

  const id = randomUUID();
  await db.query(
    `INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, mode, status, idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,'reconciled',$7,$8)`,
    [id, d.booking_id, d.project_id, demandId, input.amount, input.mode ?? "neft", key, hash]
  );
  const remaining = d.remaining - input.amount;
  const status: DemandStatus = remaining <= 0 ? "settled" : "part_paid";
  await db.query(`UPDATE demand SET status = $1 WHERE id = $2`, [status, demandId]);
  const row = await db.query<ReceiptRow>(`SELECT * FROM receipt WHERE id = $1`, [id]);
  return { ...row.rows[0], amount: input.amount, project_id: d.project_id };
}
