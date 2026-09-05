import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types";

// 18 rule 4's Policy Studio "variation approval matrix" (cr_approval_rule) — global (project_id
// NULL) rows only. UNCONFIRMED placeholders throughout — p12 names the mechanism (value/margin/
// schedule/freeze routing) but no real thresholds; inventing numbers to look populated would be
// exactly the hardcoding CLAUDE.md forbids. No PROJECTS_HEAD role exists in the 12-role seeded
// list (emergent-business-rules.md §1.3) for rule 4's "schedule impact -> PROJECTS head" — mapped
// to SITE, same class of judgment call 15/21 already made for their own vocabulary mismatches.
//
// No customisation_policy row is seeded here for East Crest: this config seed runs (in
// db/index.ts) before the demo seed that creates `p_eastcrest`, so an FK insert against it here
// would fail on a fresh boot (caught by this file's own test) — store.ts::loadPolicy already
// falls back to sane defaults (15-day validity, 100% payment gate) when no row exists, so there
// is nothing to seed.
export async function seedCrApprovalRules(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM cr_approval_rule`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  const rows: { kind: string; threshold: number | null; approver_role: string; requires_second_approver: boolean; second_approver_role: string | null }[] = [
    { kind: "VALUE", threshold: 200000, approver_role: "MANAGEMENT", requires_second_approver: false, second_approver_role: null },
    { kind: "MARGIN", threshold: 10, approver_role: "MANAGEMENT", requires_second_approver: false, second_approver_role: null },
    { kind: "SCHEDULE", threshold: 14, approver_role: "SITE", requires_second_approver: false, second_approver_role: null },
    { kind: "FREEZE", threshold: null, approver_role: "MANAGEMENT", requires_second_approver: true, second_approver_role: "SUPER_ADMIN" },
  ];
  for (const r of rows) {
    await db.query(
      `INSERT INTO cr_approval_rule (id, project_id, kind, threshold, approver_role, requires_second_approver, second_approver_role) VALUES ($1,NULL,$2,$3,$4,$5,$6)`,
      [randomUUID(), r.kind, r.threshold, r.approver_role, r.requires_second_approver, r.second_approver_role]
    );
  }
}
