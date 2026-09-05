import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { DbLike } from "../events";
import type { Score, ScoreType } from "./contract";

// Rule 4's snapshot history — persisted every time a score is computed (this codebase has no
// scheduler/event-debounce mechanism to do it on a 1-min-debounced event feed or nightly, same
// gap already documented for 06/19/21/12/13; compute-on-read is the honest substitute).

export async function previousValue(scoreType: ScoreType, subjectId: string): Promise<number | null> {
  const r = await db.query<{ value: number }>(
    `SELECT value::float8 AS value FROM score_snapshot
      WHERE score_type = $1 AND subject_id = $2 AND computed_at <= now() - interval '7 days'
      ORDER BY computed_at DESC LIMIT 1`,
    [scoreType, subjectId]
  );
  return r.rows[0]?.value ?? null;
}

export async function persistSnapshot(
  scoreType: ScoreType,
  subjectType: string,
  subjectId: string,
  projectId: string | null,
  score: Score,
  tx: DbLike = db
): Promise<void> {
  await tx.query(
    `INSERT INTO score_snapshot (id, score_type, subject_type, subject_id, project_id, value, trend, drivers, confidence, confidence_reason, actions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)`,
    [
      "scr_" + randomUUID().slice(0, 8), scoreType, subjectType, subjectId, projectId,
      score.value, score.trend, JSON.stringify(score.drivers), score.confidence, score.confidence_reason, JSON.stringify(score.actions),
    ]
  );
}
