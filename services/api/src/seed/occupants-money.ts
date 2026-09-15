import { db } from "../db";
import { postReceipt } from "../demands-receipts";
import { recordPtp } from "../demands";
import { createLoanCase, patchLoanCase, recordLoanEvent } from "../loans/core";
import { createSnag } from "../qa/snags";
import { accounts, banking, qa, ANANYA, KARTHIK, MEERA, ROHAN } from "./occupants-ctx";

async function settle(demandId: string, amount: number, key: string): Promise<void> {
  await postReceipt(demandId, { amount, mode: "neft", idempotency_key: key }, accounts);
}

export async function seedKarthikMoney(): Promise<void> {
  await settle(KARTHIK.demand_ids[0], 1_200_000, "seed-v110-booking");
  await db.query(
    `UPDATE demand SET due_date = CURRENT_DATE - 10, status = 'overdue' WHERE id = $1`,
    [KARTHIK.demand_ids[2]]
  );
  await db.query(
    `UPDATE demand SET due_date = CURRENT_DATE - 70, status = 'overdue' WHERE id = $1`,
    [KARTHIK.demand_ids[3]]
  );
  // Column-only leftover: setOverdueReason also emits demand.reason_recorded, which would
  // double-count demands.test.ts's assertion that the handler itself writes exactly one event.
  await db.query(`UPDATE demand SET overdue_reason_code = 'customer_delay' WHERE id = $1`, [KARTHIK.demand_ids[2]]);
  await db.query(`UPDATE demand SET overdue_reason_code = 'unresponsive' WHERE id = $1`, [KARTHIK.demand_ids[3]]);
}

export async function seedMeeraMoney(): Promise<void> {
  await createLoanCase(
    MEERA.booking_id,
    { lender_name: "HDFC", requested_amount_inr: 6_000_000 },
    banking,
    { id: "lc_v111", code: "LN-DEMO01" }
  );
  await patchLoanCase("lc_v111", { sanctioned_amount_inr: 6_000_000 }, banking);
  await recordLoanEvent("lc_v111", { type: "DOCS_REQUESTED" }, banking);
  await db.query(
    `UPDATE demand SET loan_dependent = false WHERE booking_id = $1 AND id <> $2 AND status NOT IN ('settled','waived')`,
    [MEERA.booking_id, MEERA.demand_ids[0]]
  );
  await db.query(
    `UPDATE demand SET due_date = CURRENT_DATE - 5, status = 'disputed', overdue_reason_code = 'dispute_raised' WHERE id = $1`,
    [MEERA.demand_ids[1]]
  );
  await db.query(
    `UPDATE demand SET due_date = CURRENT_DATE + 5, status = 'due' WHERE id = $1`,
    [MEERA.demand_ids[2]]
  );
  const ptp = await db.query<{ d: string }>(`SELECT (CURRENT_DATE + 12)::text AS d`);
  await recordPtp(MEERA.demand_ids[2], { expected_date: ptp.rows[0].d, expected_amount: 1_600_000 }, accounts);
  await createSnag(
    {
      unit_id: MEERA.unit_id,
      room: "OTHER",
      category: "ELECTRICAL",
      severity: "CRITICAL",
      description: "Exposed live wiring at the distribution board",
      location: "Electrical panel",
      trade: "electrical",
    },
    qa,
    "s_v111_1"
  );
}

export async function seedAnanyaMoney(): Promise<void> {
  const amts = [1_000_000, 3_000_000, 2_000_000, 2_000_000, 1_000_000];
  for (let i = 0; i < 5; i++) await settle(ANANYA.demand_ids[i], amts[i], `seed-v112-${i + 1}`);
}

export async function seedRohanMoney(): Promise<void> {
  const amts = [950_000, 2_850_000, 1_900_000, 1_900_000, 1_900_000];
  for (let i = 0; i < 5; i++) await settle(ROHAN.demand_ids[i], amts[i], `seed-v113-${i + 1}`);
}
