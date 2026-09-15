import { db } from "../db";

/** Effective score_weight rows for a score_type. Studio is the source; seed populates defaults. */

export async function loadScoreWeights(scoreType: string): Promise<Record<string, number>> {
  const r = await db.query<{ component: string; weight: number }>(
    `SELECT DISTINCT ON (component) component, weight::float8 AS weight
       FROM score_weight
      WHERE score_type = $1
        AND effective_from <= CURRENT_DATE
        AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
      ORDER BY component, version DESC`,
    [scoreType]
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.component] = row.weight;
  return out;
}
