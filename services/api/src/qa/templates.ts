import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { DbLike } from "../events";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";

// 15-qa-evidence-snags.md `qa_checklist_template`. A product-specific template beats the
// all-products one for the same component; newest version wins within a match.

export type EvidenceKind = "NONE" | "PHOTO" | "TEST_REPORT" | "CERTIFICATE";
export type SnagSeverity = "CRITICAL" | "MAJOR" | "MINOR";

export interface TemplateItem {
  code: string;
  label: string;
  evidence: EvidenceKind;
  required: boolean;
  severity?: SnagSeverity;
  category?: string;
}

export interface TemplateRow {
  id: string;
  component_code: string;
  product_types: string[] | null;
  items: TemplateItem[];
  min_photos: number;
  version: number;
  effective_from: string;
  effective_to: string | null;
}

const TEMPLATE_EDIT_ROLES = ["QA", "SUPER_ADMIN"]; // studio/registry.ts 15.qa_checklist_templates edit_roles

export async function resolveTemplate(componentCode: string, productType: string, tx: DbLike = db): Promise<TemplateRow | null> {
  const r = await tx.query<TemplateRow>(
    `SELECT id, component_code, product_types, items, min_photos, version, effective_from::text AS effective_from, effective_to::text AS effective_to
       FROM qa_checklist_template
      WHERE component_code = $1 AND (product_types IS NULL OR $2 = ANY(product_types))
        AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY (product_types IS NULL) ASC, version DESC
      LIMIT 1`,
    [componentCode, productType]
  );
  return r.rows[0] ?? null;
}

export async function listTemplates(ctx: Ctx): Promise<TemplateRow[]> {
  requireRole(ctx, ["QA", "SITE", "MANAGEMENT", "SUPER_ADMIN"]);
  const r = await db.query<TemplateRow>(
    `SELECT id, component_code, product_types, items, min_photos, version, effective_from::text AS effective_from, effective_to::text AS effective_to
       FROM qa_checklist_template ORDER BY component_code, product_types NULLS FIRST, version`
  );
  return r.rows;
}

/** PUT: a new template row (fresh id, version = prior max + 1) that supersedes the current one for
 *  the same component/product_types by closing its effective_to. Old rows stay — inspections
 *  reference them by template_id. */
export async function upsertTemplate(
  input: { component_code: string; product_types?: string[] | null; items: TemplateItem[]; min_photos?: number },
  ctx: Ctx
): Promise<TemplateRow> {
  requireRole(ctx, TEMPLATE_EDIT_ROLES);
  if (!input.component_code) throw new AppError("validation", "component_code is required", "component_code");
  if (!Array.isArray(input.items) || input.items.length === 0) throw new AppError("validation", "items must be a non-empty list", "items");
  for (const it of input.items) {
    if (!it.code || !it.label) throw new AppError("validation", "every item needs code and label", "items");
    if (!["NONE", "PHOTO", "TEST_REPORT", "CERTIFICATE"].includes(it.evidence)) throw new AppError("validation", `invalid evidence kind ${it.evidence}`, "items");
  }
  const productTypes = input.product_types && input.product_types.length > 0 ? input.product_types : null;
  const prior = await db.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0)::int AS version FROM qa_checklist_template
      WHERE component_code = $1 AND COALESCE(product_types::text, '') = COALESCE($2::text[]::text, '')`,
    [input.component_code, productTypes]
  );
  await db.query(
    `UPDATE qa_checklist_template SET effective_to = CURRENT_DATE - 1
      WHERE component_code = $1 AND COALESCE(product_types::text, '') = COALESCE($2::text[]::text, '') AND effective_to IS NULL`,
    [input.component_code, productTypes]
  );
  const id = "qat_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO qa_checklist_template (id, component_code, product_types, items, min_photos, version, effective_from)
     VALUES ($1,$2,$3::text[],$4::jsonb,$5,$6,CURRENT_DATE)`,
    [id, input.component_code, productTypes, JSON.stringify(input.items), input.min_photos ?? 0, (prior.rows[0]?.version ?? 0) + 1]
  );
  const r = await db.query<TemplateRow>(
    `SELECT id, component_code, product_types, items, min_photos, version, effective_from::text AS effective_from, effective_to::text AS effective_to
       FROM qa_checklist_template WHERE id = $1`,
    [id]
  );
  return r.rows[0]!;
}
