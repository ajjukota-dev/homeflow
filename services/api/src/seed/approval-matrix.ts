import type { DbClient } from "../db/types";

// 25-policy-studio.md rule 2 / 13-promise-ledger.md rule 2: COMMITMENT/INR bands are config,
// not an in-code ₹ threshold. Half-open [min, max). Not East Crest SOP.

export async function seedCommitmentApprovalBands(db: DbClient): Promise<void> {
  const existing = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM approval_authority_rule WHERE domain = 'COMMITMENT' AND metric = 'INR'`
  );
  if (Number(existing.rows[0]?.n ?? 0) > 0) return;

  await db.query(
    `INSERT INTO approval_authority_rule
       (id, domain, metric, min, max, approver_role, project_id, effective_from)
     VALUES
       ('aar_cmt_inr_crm', 'COMMITMENT', 'INR', 0, 200000, 'CRM', NULL, '2020-01-01'),
       ('aar_cmt_inr_mgmt', 'COMMITMENT', 'INR', 200000, NULL, 'MANAGEMENT', NULL, '2020-01-01')`
  );
}
