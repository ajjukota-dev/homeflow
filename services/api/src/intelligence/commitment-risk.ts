import { getCommitment } from "../commitments/core";
import { trendFrom, topDrivers, type Score, type ScoreDriver } from "../scores/contract";
import { previousValue } from "../scores/store";
import { recordScore } from "./shared";
import type { Ctx } from "../authz/types";

// 31-intelligence.md rule 3 — "Commitment risk = 13 confidence inverse." Not in the spec's own
// API list (only customer-health/financial-health/journey-risk get a `/scores/*` route, plus
// `/demands/:id/risk`) — added the symmetric `/commitments/:id/risk` route anyway, since rule 3's
// own text says "All exposed via /scores/*" and 13's `confidence` is already a real, computed
// value (`commitments/confidence.ts`), not a re-derivation. Flagged as a route the API section's
// shorthand list didn't spell out, not invented business logic.

export async function computeCommitmentRisk(commitmentId: string, ctx: Ctx): Promise<Score> {
  const commitment = await getCommitment(commitmentId, ctx);
  const value = Math.max(0, Math.min(100, 100 - commitment.confidence));
  const allDrivers: ScoreDriver[] = commitment.confidence_drivers
    .filter((d) => d.delta < 0)
    .map((d) => ({ code: "CONFIDENCE_DRIVER", label: d.label, contribution: -d.delta, fact: d.label }));

  const previous = await previousValue("COMMITMENT_RISK", commitmentId);
  const score: Score = {
    value,
    trend: trendFrom(value, previous),
    drivers: topDrivers(allDrivers, 3),
    confidence: "HIGH",
    confidence_reason: "direct inverse of 13's own confidence score — same drivers, not re-derived",
    actions: [],
  };
  await recordScore("COMMITMENT_RISK", "commitment", commitmentId, commitment.project_id, score, previous);
  return score;
}
