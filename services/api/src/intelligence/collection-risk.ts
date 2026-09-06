import { db } from "../db";
import { DEMAND_SELECT, mapDemands } from "../demands";
import { explainCustomerHealth } from "./customer-health";
import { trendFrom, topDrivers, type Score, type ScoreDriver } from "../scores/contract";
import { previousValue } from "../scores/store";
import { recordScore } from "./shared";
import { AppError } from "../authz/types";

// 31-intelligence.md rule 3 — Collection risk per demand: "20 probability inverse + reason
// category + customer health." `forecast_line.probability` (20) is the real, already-computed
// collection probability for this exact demand (the same figure the cash-forecast view shows) —
// risk = 1 - probability, not a re-derivation. `overdue_reason_code` (19) is a real column but,
// per `forecast/probability.ts`'s own header comment, has no numeric weight anywhere in this
// codebase (no category grouping beyond the code itself) — used here as a display fact only, same
// treatment that file already gives it. Customer health folds in via `computeCustomerHealth` on
// the demand's own customer, a real cross-service call (not duplicated logic).

const PROBABILITY_WEIGHT = 50;
const CUSTOMER_HEALTH_WEIGHT = 20;

interface Built { value: number; allDrivers: ScoreDriver[] }

async function build(demandId: string): Promise<Built> {
  const rows = await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]);
  const demand = rows[0];
  if (!demand) throw new AppError("not_found", "demand not found");

  let value = 0;
  const allDrivers: ScoreDriver[] = [];

  const forecast = await db.query<{ probability: number }>(
    `SELECT probability::float8 AS probability FROM forecast_line
      WHERE demand_id = $1 AND status = 'ACTIVE' AND lane = 'COMMITTED' ORDER BY created_at DESC LIMIT 1`,
    [demandId]
  );
  const probability = forecast.rows[0]?.probability;
  if (probability !== undefined) {
    const penalty = Math.round(PROBABILITY_WEIGHT * (1 - probability));
    value += penalty;
    allDrivers.push({ code: "PROBABILITY_INVERSE", label: "Inverse of collection probability", contribution: penalty, fact: `${Math.round(probability * 100)}% forecast collection probability` });
  }

  if (demand.overdue_reason_code) {
    allDrivers.push({ code: "REASON_CATEGORY", label: "Delay reason category", contribution: 0, fact: `reason: ${demand.next_action ?? demand.overdue_reason_code}` });
  }

  const customer = await db.query<{ customer_id: string | null }>(
    `SELECT a.customer_id FROM booking_applicant a WHERE a.booking_id = $1 AND a.role = 'primary'`,
    [demand.booking_id]
  );
  const customerId = customer.rows[0]?.customer_id;
  if (customerId) {
    const health = await explainCustomerHealth(customerId); // explain (no persist) — reading a demand's risk must not write a CUSTOMER_HEALTH snapshot as a side effect
    if (health.value < 60) {
      const penalty = Math.round(CUSTOMER_HEALTH_WEIGHT * ((60 - health.value) / 60));
      value += penalty;
      allDrivers.push({ code: "CUSTOMER_HEALTH", label: "Customer Health score", contribution: penalty, fact: `customer health ${health.value}/100` });
    }
  }

  return { value: Math.min(100, value), allDrivers };
}

export async function computeCollectionRisk(demandId: string): Promise<Score> {
  const { value, allDrivers } = await build(demandId);
  const previous = await previousValue("COLLECTION_RISK", demandId);
  const score: Score = {
    value,
    trend: trendFrom(value, previous),
    drivers: topDrivers(allDrivers, 3),
    confidence: "MEDIUM",
    confidence_reason: "probability inverse + customer health composite — reason category is a display fact only, no numeric weight exists anywhere in this codebase for it (same gap 20's own probability.ts already flags)",
    actions: [],
  };
  const rows = await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [demandId]);
  await recordScore("COLLECTION_RISK", "demand", demandId, rows[0]?.project_id ?? null, score, previous);
  return score;
}
