import { db } from "../db";
import { requireRole, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";

// Config export/import (25-policy-studio.md rule 6, "for cloning a new project from a template
// project" — the spec's own "[ours]" marker, so no client acceptance criteria to match against).
// Export is a read-only bundle, safe to build now. Import is a destructive cross-table write
// (journey template assignment, calendar/SLA/approval-rule rows) with zero consumers today —
// nothing yet creates a second real project to clone INTO — so it's a clearly-failing stub
// rather than a half-built writer nobody has exercised end to end (rule 6 flag-don't-fake call,
// advisor review). Real when a second project needs cloning.

export interface ProjectConfigExport {
  project_id: string;
  exported_at: string;
  journey_template_version: Record<string, unknown> | null;
  project_calendars: Record<string, unknown>[];
  delay_reasons: Record<string, unknown>[];
  sla_policies: Record<string, unknown>[];
  approval_authority_rules: Record<string, unknown>[];
}

export async function exportProjectConfig(projectId: string, ctx: Ctx): Promise<ProjectConfigExport> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  const project = await db.query<{ id: string }>(`SELECT id FROM project WHERE id = $1`, [projectId]);
  if (!project.rows[0]) throw new AppError("not_found", "project not found");

  const journeyVersion = await db.query<Record<string, unknown>>(
    `SELECT jtv.* FROM journey_template_version jtv JOIN project p ON p.journey_template_version_id = jtv.id WHERE p.id = $1`,
    [projectId]
  );
  // project_calendar/sla_policy carry no project_id today (06 seeded one global calendar/policy
  // set) — exported as-is rather than pretending they're project-scoped.
  const calendars = await db.query<Record<string, unknown>>(`SELECT * FROM project_calendar`);
  const delayReasons = await db.query<Record<string, unknown>>(`SELECT * FROM delay_reason`);
  const slaPolicies = await db.query<Record<string, unknown>>(`SELECT * FROM sla_policy`);
  const approvalRules = await db.query<Record<string, unknown>>(`SELECT * FROM approval_authority_rule WHERE project_id = $1 OR project_id IS NULL`, [projectId]);

  return {
    project_id: projectId,
    exported_at: new Date().toISOString(),
    journey_template_version: journeyVersion.rows[0] ?? null,
    project_calendars: calendars.rows,
    delay_reasons: delayReasons.rows,
    sla_policies: slaPolicies.rows,
    approval_authority_rules: approvalRules.rows,
  };
}

export async function importProjectConfig(_projectId: string, ctx: Ctx): Promise<never> {
  requireRole(ctx, POLICY_STUDIO_ROLES);
  throw new AppError("validation", "config import is not implemented yet — export only (see TODO.md)");
}
