import { randomUUID } from "node:crypto";
import { db } from "../db";
import { requireRole, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import type { Ctx } from "../authz/types";
import { TEMPLATE_SELECT, type ChecklistTemplateRow } from "./store";

// Policy Studio: "Registration checklists" + "SRO offices" tabs (25's Tabs line), backed by the
// one registration_checklist_template table — same "one table, two edit surfaces" shape 18 used
// for cr_approval_rule/customisation_policy. Registration is the department lead per rule 7's
// writer list (rule 3 of 25 doesn't name it explicitly, but the tab registry pre-dates this build
// with edit_roles: ["REGISTRATION"] already set — kept as-is).
const TEMPLATE_EDIT_ROLES = [...POLICY_STUDIO_ROLES, "REGISTRATION"];

export async function listChecklistTemplates(ctx: Ctx): Promise<ChecklistTemplateRow[]> {
  requireRole(ctx, [...TEMPLATE_EDIT_ROLES, "LEGAL"]);
  return (await db.query<ChecklistTemplateRow>(`${TEMPLATE_SELECT} ORDER BY project_id NULLS FIRST, jurisdiction NULLS FIRST`)).rows;
}

export interface PutTemplateInput {
  project_id?: string | null;
  jurisdiction?: string | null;
  pre_items: { key: string; label: string }[];
  day_of_items: { key: string; label: string }[];
  sro_offices: string[];
  jurisdiction_lead_days: number;
}

export async function putChecklistTemplate(input: PutTemplateInput, ctx: Ctx): Promise<ChecklistTemplateRow> {
  requireRole(ctx, TEMPLATE_EDIT_ROLES);
  const projectId = input.project_id ?? null;
  const jurisdiction = input.jurisdiction ?? null;
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM registration_checklist_template WHERE project_id IS NOT DISTINCT FROM $1 AND jurisdiction IS NOT DISTINCT FROM $2`,
    [projectId, jurisdiction]
  );
  const id = existing.rows[0]?.id ?? "regtpl_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO registration_checklist_template (id, project_id, jurisdiction, pre_items, day_of_items, sro_offices, jurisdiction_lead_days)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)
     ON CONFLICT (id) DO UPDATE SET pre_items = $4::jsonb, day_of_items = $5::jsonb, sro_offices = $6::jsonb, jurisdiction_lead_days = $7, updated_at = now()`,
    [id, projectId, jurisdiction, JSON.stringify(input.pre_items), JSON.stringify(input.day_of_items), JSON.stringify(input.sro_offices), input.jurisdiction_lead_days]
  );
  const r = await db.query<ChecklistTemplateRow>(`${TEMPLATE_SELECT} WHERE id = $1`, [id]);
  return r.rows[0]!;
}
