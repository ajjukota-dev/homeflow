import { db } from "./db";
import { financialClearance } from "./clearance";
import { listDemands } from "./demands";

// H7 loader — policy threshold from collection_policy, never a hard-coded %.

export async function bookingFinance(bookingId: string) {
  const b = await db.query<{ project_id: string; total_consideration: number }>(
    `SELECT project_id, total_consideration::float8 AS total_consideration FROM booking WHERE id = $1`,
    [bookingId]
  );
  if (b.rows.length === 0) throw new Error("booking_not_found");
  const policy = await db.query<{ registration_min_pct: number }>(
    `SELECT registration_min_pct::float8 AS registration_min_pct FROM collection_policy WHERE project_id = $1`,
    [b.rows[0].project_id]
  );
  const paidRow = await db.query<{ paid: number }>(
    `SELECT COALESCE(SUM(amount),0)::float8 AS paid FROM receipt
      WHERE booking_id = $1 AND status IN ('posted','reconciled')`,
    [bookingId]
  );
  const demands = await listDemands(bookingId);
  const disputed = demands
    .filter((d) => d.status === "disputed")
    .reduce((sum, d) => sum + d.remaining, 0);
  const paid = Number(paidRow.rows[0]?.paid ?? 0);
  const clearance = financialClearance({
    paid,
    consideration: b.rows[0].total_consideration,
    threshold_pct: policy.rows[0]?.registration_min_pct ?? 0.7,
    disputed,
  });
  return {
    ...clearance,
    paid,
    disputed,
    consideration: b.rows[0].total_consideration,
    project_id: b.rows[0].project_id,
  };
}
