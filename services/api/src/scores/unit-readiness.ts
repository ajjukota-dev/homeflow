import { db } from "../db";
import { componentsFor } from "../qa-evidence";
import { snagCounts } from "../qa-snags";
import { readinessScore } from "../readiness";
import { trendFrom, topDrivers, type Score, type ScoreDriver, type ScoreAction } from "./contract";
import { previousValue, persistSnapshot } from "./store";

// Rule 1. Reuses the existing `readinessScore`/`componentsFor` engine (qa/spec.md's pre-14 base)
// rather than re-deriving it — real scope cut, flagged: that engine is a binary
// qa_verified/critical-snag model, not rule 1's full weighted VERIFIED(1.0)/COMPLETE-site-
// declared(0.7)/IN_PROGRESS-by-checklist-share/NOT_STARTED(0) state machine with per-component
// weights and an evidence_required cap — that finer state model needs 07 (unit progress control),
// which isn't built. Confidence is MEDIUM for exactly this reason, not HIGH.

interface Built { value: number; allDrivers: ScoreDriver[]; actions: ScoreAction[] }

async function build(unitId: string): Promise<Built> {
  const components = await componentsFor(unitId);
  const { critical } = await snagCounts(unitId);
  const { value } = readinessScore(components.map((c) => ({ code: c.code, qa_verified: Boolean(c.qa_verified) })), critical);

  const total = components.length || 1;
  const share = 100 / total;
  const allDrivers: ScoreDriver[] = components
    .filter((c) => !c.qa_verified)
    .map((c) => ({ code: c.code, label: `${c.label} not yet QA-verified`, contribution: Math.round(share), fact: "site-declared only, no independent QA verification" }));
  if (critical > 0) allDrivers.push({ code: "CRITICAL_SNAG", label: `${critical} critical snag(s) open`, contribution: 25 * critical, fact: `${critical} open critical snag(s), each subtracts 25` });

  const actions = components.filter((c) => !c.qa_verified).slice(0, 3).map((c) => ({ action_type: "exec_verification", title: `Verify ${c.label}`, target: c.code }));
  return { value, allDrivers, actions };
}

export async function computeUnitReadiness(unitId: string): Promise<Score> {
  const { value, allDrivers, actions } = await build(unitId);
  const previous = await previousValue("UNIT_READINESS", unitId);
  const project = await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = $1`, [unitId]);
  const score: Score = {
    value,
    trend: trendFrom(value, previous),
    drivers: topDrivers(allDrivers, 3),
    confidence: "MEDIUM",
    confidence_reason: "binary QA-verified model — rule 1's full weighted component-state model needs 07 (unit progress control), not yet built",
    actions,
  };
  await persistSnapshot("UNIT_READINESS", "unit", unitId, project.rows[0]?.project_id ?? null, score);
  return score;
}

/** Rule 5's `.../explain` — the full contribution table, not just the top 3. Computed live, not
 *  read from the persisted snapshot (score_snapshot.drivers is spec'd as exactly 3, ordered). */
export async function explainUnitReadiness(unitId: string): Promise<Score> {
  const { value, allDrivers, actions } = await build(unitId);
  const previous = await previousValue("UNIT_READINESS", unitId);
  return {
    value,
    trend: trendFrom(value, previous),
    drivers: allDrivers,
    confidence: "MEDIUM",
    confidence_reason: "binary QA-verified model — rule 1's full weighted component-state model needs 07 (unit progress control), not yet built",
    actions,
  };
}
