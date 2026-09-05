import { randomUUID } from "node:crypto";
import { db } from "./db";
import { appendEvent, withTx, actorFields } from "./events";
import { authorize } from "./authz/authorize";
import type { Ctx } from "./authz/types";

// Rule 7 (19-collections-true-risk.md): TDS applicability + verification. §194IA: 1% TDS applies
// when the agreement value is >= ₹50,00,000. The system only ever SUGGESTS — Accounts decides
// (spec's own "human decides (client question)"), so suggestTdsApplicability never writes
// anything; it's read-only advice the caller shows before upsertTdsRecord is called.

const TDS_THRESHOLD_INR = 50_00_000;
const TDS_RATE_PCT = 1;

export interface TdsSuggestion {
  suggested: "APPLICABLE" | "NOT_APPLICABLE";
  reason: string;
  suggested_amount: number | null;
}

export async function suggestTdsApplicability(bookingId: string): Promise<TdsSuggestion> {
  const b = await db.query<{ agreement_value_inr: number | null }>(
    `SELECT agreement_value_inr::float8 AS agreement_value_inr FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (!b.rows[0]) throw new Error("not_found");
  const value = b.rows[0].agreement_value_inr ?? 0;
  if (value >= TDS_THRESHOLD_INR) {
    return {
      suggested: "APPLICABLE",
      reason: `§194IA: agreement value ₹${value} >= ₹${TDS_THRESHOLD_INR} threshold`,
      suggested_amount: Math.round((value * TDS_RATE_PCT) / 100),
    };
  }
  return { suggested: "NOT_APPLICABLE", reason: `agreement value ₹${value} below the §194IA threshold`, suggested_amount: null };
}

export interface TdsRecordRow {
  id: string;
  booking_id: string;
  demand_id: string | null;
  applicability: "NOT_DETERMINED" | "APPLICABLE" | "NOT_APPLICABLE";
  na_reason: string | null;
  amount: number | null;
  challan_number: string | null;
  challan_date: string | null;
  pan: string | null;
  file_id: string | null;
  status: "PENDING" | "NOT_REQUIRED" | "VERIFIED" | "REJECTED";
}

/** Accounts records the human decision (rule 7). NOT_APPLICABLE requires a reason. */
export async function upsertTdsRecord(
  bookingId: string,
  input: { demand_id?: string | null; applicability: "APPLICABLE" | "NOT_APPLICABLE"; na_reason?: string | null; amount?: number | null },
  ctx: Ctx
): Promise<TdsRecordRow> {
  await authorize(ctx, "collections", "WRITE");
  if (input.applicability === "NOT_APPLICABLE" && !input.na_reason?.trim()) {
    throw new Error("na_reason_required");
  }
  const status = input.applicability === "NOT_APPLICABLE" ? "NOT_REQUIRED" : "PENDING";
  const id = "tds_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO tds_record (id, booking_id, demand_id, applicability, na_reason, amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, bookingId, input.demand_id ?? null, input.applicability, input.na_reason ?? null, input.amount ?? null, status]
  );
  return requireTdsRecord(id);
}

async function requireTdsRecord(id: string): Promise<TdsRecordRow> {
  const r = await db.query<TdsRecordRow>(
    `SELECT id, booking_id, demand_id, applicability, na_reason, amount::float8 AS amount,
            challan_number, challan_date::text AS challan_date, pan, file_id, status
       FROM tds_record WHERE id = $1`,
    [id]
  );
  if (!r.rows[0]) throw new Error("not_found");
  return r.rows[0];
}

/** Rule 7: "verify requires all fields + challan file." Feeds financial_clearance's
 *  tds_verified guard and journey task T8 (05/06, not wired here — no consumer built yet). */
export async function verifyTds(
  id: string,
  input: { challan_number: string; challan_date: string; pan: string; file_id: string },
  ctx: Ctx
): Promise<TdsRecordRow> {
  await authorize(ctx, "collections", "WRITE");
  if (!input.challan_number?.trim() || !input.challan_date || !input.pan?.trim() || !input.file_id?.trim()) {
    throw new Error("all_fields_required");
  }
  const existing = await requireTdsRecord(id);
  if (existing.applicability !== "APPLICABLE") throw new Error("not_applicable");

  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE tds_record SET status = 'VERIFIED', challan_number = $1, challan_date = $2, pan = $3, file_id = $4,
              verified_by = $5, verified_at = now()
        WHERE id = $6`,
      [input.challan_number, input.challan_date, input.pan, input.file_id, ctx.actor.user_id, id]
    );
    await appendEvent(tx, {
      type: "tds.verified",
      entity_type: "tds_record",
      entity_id: id,
      booking_id: existing.booking_id,
      payload: { challan_number: input.challan_number },
      ...actorFields(ctx),
    });
  });
  return requireTdsRecord(id);
}

export async function rejectTds(id: string, reason: string, ctx: Ctx): Promise<TdsRecordRow> {
  await authorize(ctx, "collections", "WRITE");
  if (!reason?.trim()) throw new Error("reason_required");
  const existing = await requireTdsRecord(id);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE tds_record SET status = 'REJECTED' WHERE id = $1`, [id]);
    await appendEvent(tx, {
      type: "tds.rejected",
      entity_type: "tds_record",
      entity_id: id,
      booking_id: existing.booking_id,
      payload: { reason },
      ...actorFields(ctx),
    });
  });
  return requireTdsRecord(id);
}
