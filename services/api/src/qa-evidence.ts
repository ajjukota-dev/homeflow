import { db } from "./db";

// Component QA-evidence lookup feeding unit readiness scoring (qa/spec.md).

export async function componentsFor(unitId: string) {
  const r = await db.query<{ code: string; label: string; qa_verified: boolean }>(
    `SELECT c.code, c.label, COALESCE(e.qa_verified, false) AS qa_verified
       FROM component_definition c
       LEFT JOIN qa_evidence e ON e.component_code = c.code AND e.unit_id = $1
      ORDER BY c.sort_order`,
    [unitId]
  );
  return r.rows;
}
