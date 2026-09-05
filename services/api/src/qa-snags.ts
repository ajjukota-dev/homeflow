import { db } from "./db";

// Snag row shape and queries — feeds readiness scoring, handover eligibility, and the snag list (qa/spec.md).

export type SnagRow = {
  id: string; unit_id: string; severity: string; location: string;
  trade: string; description: string; status: string; is_repeat: boolean;
};

export async function snagCounts(unitId: string) {
  const r = await db.query<{ severity: string; n: number }>(
    `SELECT severity, COUNT(*)::int AS n FROM snag
      WHERE unit_id = $1 AND status NOT IN ('closed','verified')
      GROUP BY severity`,
    [unitId]
  );
  // Case-insensitive: rls.test.ts writes 'MINOR' while the seed and qa/snags.ts write lowercase.
  const count = (sev: string) => r.rows.filter((x) => x.severity.toLowerCase() === sev).reduce((s, x) => s + x.n, 0);
  return { critical: count("critical"), major: count("major"), minor: count("minor") };
}

export async function listSnagsForUnit(unitId: string) {
  const r = await db.query<SnagRow>(
    `SELECT id, unit_id, severity, location, trade, description, status, is_repeat
       FROM snag WHERE unit_id = $1 ORDER BY created_at`,
    [unitId]
  );
  return r.rows;
}
