import type { DbLike } from "../events";

// Shared by core.ts (DLP-closure sweep) and warranty.ts (per-case coverage) — pulled out to its
// own file rather than one importing from the other, avoiding a circular dependency between them
// (core.ts's openPostHandoverCase and warranty.ts's addServiceRecord call already cross the other
// direction).

export interface DlpPolicyRow { windows: { category: string; months: number }[] }

/** Resolves the most specific `dlp_policy` row: project+product_type override, else the global
 *  default for that product_type, else the global DEFAULT fallback. Three sequential lookups
 *  rather than a single UNION ALL + LIMIT 1, since UNION ALL's row order relative to a LIMIT with
 *  no ORDER BY isn't something to rely on for which branch "wins." */
export async function resolveDlpPolicy(projectId: string, productType: string, tx: DbLike): Promise<DlpPolicyRow | null> {
  const scoped = await tx.query<DlpPolicyRow>(`SELECT windows FROM dlp_policy WHERE project_id = $1 AND product_type = $2`, [projectId, productType]);
  if (scoped.rows[0]) return scoped.rows[0];
  const globalForType = await tx.query<DlpPolicyRow>(`SELECT windows FROM dlp_policy WHERE project_id IS NULL AND product_type = $1`, [productType]);
  if (globalForType.rows[0]) return globalForType.rows[0];
  const fallback = await tx.query<DlpPolicyRow>(`SELECT windows FROM dlp_policy WHERE project_id IS NULL AND product_type = 'DEFAULT'`);
  return fallback.rows[0] ?? null;
}
