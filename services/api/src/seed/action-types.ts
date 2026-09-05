import type { DbClient } from "../db/types";

// action_type config (10-universal-action.md `action_type`), one row per execution_type — see
// migrations/0009_actions.sql's header for why this is keyed by execution_type and not by
// task_code (05's PROJECT-scope templates can mint new task codes at any time; action_type
// must never need a matching new row for one to exist). default_owner_role/default_priority
// exist only as a fallback for a bare manual action (POST /actions) that omits them — the one
// wired Source (task instances, journey/instances.ts) always supplies every per-task field
// explicitly from the task's own template row, so these fallbacks are never exercised there.
const TYPES: { code: string; family: string; label: string; evidence_requirement: string }[] = [
  { code: "exec_simple", family: "TASK", label: "Task", evidence_requirement: "NONE" },
  { code: "exec_verification", family: "VERIFICATION", label: "Verification", evidence_requirement: "NONE" },
  { code: "exec_evidence", family: "TASK", label: "Evidence task", evidence_requirement: "VERIFIED_ATTACHMENT" },
  { code: "exec_approval", family: "APPROVAL", label: "Approval", evidence_requirement: "APPROVAL" },
  { code: "exec_checklist", family: "TASK", label: "Checklist task", evidence_requirement: "CHECKLIST" },
  { code: "exec_external", family: "TASK", label: "External reference task", evidence_requirement: "EXTERNAL_REF" },
];

export async function seedActionTypes(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM action_type`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  for (const t of TYPES) {
    await db.query(
      `INSERT INTO action_type (code, family, label, default_owner_role, default_priority, default_evidence_requirement)
       VALUES ($1,$2,$3,'MANAGEMENT','MEDIUM',$4)`,
      [t.code, t.family, t.label, t.evidence_requirement]
    );
  }
}

/** journey/instances.ts's execution_type -> action_type.code mapping (06's TaskInput.execution_type). */
export const EXECUTION_TYPE_TO_ACTION_TYPE: Record<string, string> = {
  SIMPLE: "exec_simple",
  VERIFICATION: "exec_verification",
  EVIDENCE: "exec_evidence",
  APPROVAL: "exec_approval",
  CHECKLIST: "exec_checklist",
  EXTERNAL: "exec_external",
};
