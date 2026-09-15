import type { DbClient } from "../db/types";

// 14-readiness-scores.md: score_weight rows the scorers read. Values match the former
// in-code WEIGHTS so a fresh DB keeps the same numbers until Studio edits them.

const ROWS: { id: string; score_type: string; component: string; weight: number }[] = [
  { id: "sw_bk_payments", score_type: "BOOKING_READINESS", component: "payments", weight: 0.35 },
  { id: "sw_bk_tds", score_type: "BOOKING_READINESS", component: "tds", weight: 0.15 },
  { id: "sw_bk_loan", score_type: "BOOKING_READINESS", component: "loan", weight: 0.15 },
  { id: "sw_bk_agreement", score_type: "BOOKING_READINESS", component: "agreement", weight: 0.15 },
  { id: "sw_bk_registration", score_type: "BOOKING_READINESS", component: "registration", weight: 0.1 },
  { id: "sw_bk_customer", score_type: "BOOKING_READINESS", component: "customerActions", weight: 0.1 },
  { id: "sw_ho_unit", score_type: "HANDOVER_READINESS", component: "unit", weight: 0.4 },
  { id: "sw_ho_snags", score_type: "HANDOVER_READINESS", component: "snags", weight: 0.2 },
  { id: "sw_ho_fm", score_type: "HANDOVER_READINESS", component: "fm", weight: 0.15 },
  { id: "sw_ho_customer", score_type: "HANDOVER_READINESS", component: "customer", weight: 0.25 },
];

export async function seedScoreWeights(db: DbClient): Promise<void> {
  for (const r of ROWS) {
    await db.query(
      `INSERT INTO score_weight (id, score_type, component, weight, effective_from, version)
       VALUES ($1,$2,$3,$4,'2020-01-01',1)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.score_type, r.component, r.weight]
    );
  }
}
