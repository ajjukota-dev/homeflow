import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { todayIst } from "../authz/clock";

// 22-document-factory.md rule 1 (template resolution), rule 10 (versioned + approved, Studio
// edits never touch generated documents — enforced simply: `generateDocument` snapshots
// `body_html`/`checksum` into the document row, so a later template edit can't retroact).
// Gated on the "documents" permission module (LEGAL WRITE per the seeded matrix — trusted over
// the spec's screen list, same discipline as 08/24/15's role findings).

export type TransactionType = "SALE" | "LEASE" | "ADDENDUM" | "LETTER" | "STATEMENT" | "CUSTOMISATION" | "CANCELLATION" | "TRANSFER";
export type TemplateStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "RETIRED";

export interface TemplateRow {
  id: string; family_code: string; name: string; project_id: string | null; legal_entity: string | null; product_types: string[];
  transaction_type: TransactionType; jurisdiction: string | null; effective_from: string | null; effective_to: string | null;
  version: number; status: TemplateStatus; body_html: string; checksum: string | null; approved_by: string | null; approved_at: string | null; created_at: string;
}
const SELECT = `SELECT id, family_code, name, project_id, legal_entity, product_types, transaction_type, jurisdiction,
  effective_from::text AS effective_from, effective_to::text AS effective_to, version, status, body_html, checksum,
  approved_by, approved_at::text AS approved_at, created_at::text AS created_at FROM doc_factory_template`;

export async function loadTemplate(id: string, tx: DbLike = db): Promise<TemplateRow> {
  const r = await tx.query<TemplateRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "document template not found");
  return r.rows[0];
}

export async function listTemplates(filter: { family_code?: string; project_id?: string }, ctx: Ctx): Promise<TemplateRow[]> {
  await authorize(ctx, "documents", "READ");
  const r = await db.query<TemplateRow>(
    `${SELECT} WHERE ($1::text IS NULL OR family_code = $1) AND (project_id IS NULL OR project_id = $2) ORDER BY family_code, project_id NULLS LAST, version DESC`,
    [filter.family_code ?? null, filter.project_id ?? null]
  );
  return r.rows;
}

export interface TemplateInput {
  family_code: string; name: string; project_id?: string | null; legal_entity?: string | null; product_types?: string[];
  transaction_type: TransactionType; jurisdiction?: string | null; effective_from?: string | null; effective_to?: string | null; body_html: string;
}

/** POST /document-templates — a new DRAFT version (1 + highest existing for this family/scope). */
export async function createTemplate(input: TemplateInput, ctx: Ctx): Promise<TemplateRow> {
  await authorize(ctx, "documents", "WRITE");
  if (!input.family_code?.trim() || !input.name?.trim() || !input.body_html?.trim()) throw new AppError("validation", "family_code, name and body_html are required");
  const id = "dtpl_" + randomUUID().slice(0, 8);
  const projectId = input.project_id ?? null;
  await db.query(
    `INSERT INTO doc_factory_template (id, family_code, name, project_id, legal_entity, product_types, transaction_type, jurisdiction, effective_from, effective_to, version, body_html, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,
       1 + COALESCE((SELECT MAX(version) FROM doc_factory_template WHERE family_code = $2 AND COALESCE(project_id,'') = COALESCE($4,'')), 0),
       $11, $12)`,
    [id, input.family_code.trim(), input.name.trim(), projectId, input.legal_entity ?? null, input.product_types ?? [], input.transaction_type,
      input.jurisdiction ?? null, input.effective_from ?? null, input.effective_to ?? null, input.body_html, ctx.actor.user_id]
  );
  return loadTemplate(id);
}

/** PUT /document-templates/:id/versions/:v — DRAFT/UNDER_REVIEW only; APPROVED/RETIRED are immutable. */
export async function updateTemplate(id: string, input: Partial<Pick<TemplateInput, "name" | "body_html" | "product_types" | "jurisdiction" | "effective_from" | "effective_to">>, ctx: Ctx): Promise<TemplateRow> {
  await authorize(ctx, "documents", "WRITE");
  const t = await loadTemplate(id);
  if (t.status === "APPROVED" || t.status === "RETIRED") throw new AppError("conflict", `template is ${t.status}; create a new version instead`);
  await db.query(
    `UPDATE doc_factory_template SET name = $2, body_html = $3, product_types = $4::text[], jurisdiction = $5, effective_from = $6, effective_to = $7, updated_at = now() WHERE id = $1`,
    [id, input.name?.trim() || t.name, input.body_html ?? t.body_html, input.product_types ?? t.product_types, input.jurisdiction ?? t.jurisdiction, input.effective_from ?? t.effective_from, input.effective_to ?? t.effective_to]
  );
  return loadTemplate(id);
}

/** POST …/submit-review — DRAFT -> UNDER_REVIEW (rule 6's "validation: system" is the readiness
 *  panel at generation time, not a template-side gate; this transition is the Studio's own). */
export async function submitTemplateForReview(id: string, ctx: Ctx): Promise<TemplateRow> {
  await authorize(ctx, "documents", "WRITE");
  const t = await loadTemplate(id);
  if (t.status !== "DRAFT") throw new AppError("conflict", `template is ${t.status}`);
  await db.query(`UPDATE doc_factory_template SET status = 'UNDER_REVIEW', updated_at = now() WHERE id = $1`, [id]);
  return loadTemplate(id);
}

/** POST …/approve — retires the previously APPROVED version of the same family/scope (rule 10). */
export async function approveTemplate(id: string, changeNote: string | null, ctx: Ctx): Promise<TemplateRow> {
  await authorize(ctx, "documents", "WRITE");
  const t = await loadTemplate(id);
  if (t.status !== "UNDER_REVIEW") throw new AppError("conflict", `template is ${t.status}, submit for review first`);
  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE doc_factory_template SET status = 'RETIRED', updated_at = now()
        WHERE family_code = $1 AND COALESCE(project_id,'') = COALESCE($2,'') AND status = 'APPROVED' AND id <> $3`,
      [t.family_code, t.project_id, id]
    );
    await tx.query(`UPDATE doc_factory_template SET status = 'APPROVED', approved_by = $2, approved_at = now(), change_note = $3, updated_at = now() WHERE id = $1`, [id, ctx.actor.user_id, changeNote]);
    await appendEvent(tx, {
      type: "template.version_approved", entity_type: "doc_factory_template", entity_id: id, project_id: t.project_id ?? undefined,
      payload: { family_code: t.family_code, version: t.version }, ...actorFields(ctx),
    });
  });
  return loadTemplate(id);
}

/** POST …/retire — an APPROVED template can also be retired directly (superseded by a re-authored draft, no successor yet). */
export async function retireTemplate(id: string, ctx: Ctx): Promise<TemplateRow> {
  await authorize(ctx, "documents", "WRITE");
  const t = await loadTemplate(id);
  if (t.status !== "APPROVED") throw new AppError("conflict", `template is ${t.status}`);
  await db.query(`UPDATE doc_factory_template SET status = 'RETIRED', updated_at = now() WHERE id = $1`, [id]);
  return loadTemplate(id);
}

/** Rule 1: the APPROVED template valid for (project, product, transaction, jurisdiction, date) — a project-scoped
 *  row beats the standard (NULL project) one; effective dates default open-ended. */
export async function resolveTemplate(input: { family_code: string; project_id: string; product_type?: string | null; transaction_type?: TransactionType; jurisdiction?: string | null; asOf?: string }, tx: DbLike = db): Promise<TemplateRow | null> {
  const asOf = input.asOf ?? todayIst();
  const r = await tx.query<TemplateRow>(
    `${SELECT} WHERE family_code = $1 AND status = 'APPROVED' AND (project_id = $2 OR project_id IS NULL)
       AND ($3::text IS NULL OR $3 = ANY(product_types) OR product_types = '{}')
       AND ($4::text IS NULL OR transaction_type = $4)
       AND ($5::text IS NULL OR jurisdiction = $5)
       AND (effective_from IS NULL OR effective_from <= $6) AND (effective_to IS NULL OR effective_to >= $6)
     ORDER BY (project_id IS NULL) ASC, version DESC LIMIT 1`,
    [input.family_code, input.project_id, input.product_type ?? null, input.transaction_type ?? null, input.jurisdiction ?? null, asOf]
  );
  return r.rows[0] ?? null;
}

// --- Merge fields (config; rule 2's readiness panel resolves against these) ---
export interface MergeFieldRow { code: string; source_path: string; type: "STRING" | "NUMBER" | "DATE" | "MONEY" | "BOOLEAN"; format: string | null; required: boolean; sensitivity: string | null }

export async function listMergeFields(ctx: Ctx): Promise<MergeFieldRow[]> {
  await authorize(ctx, "documents", "READ");
  const r = await db.query<MergeFieldRow>(`SELECT code, source_path, type, format, required, sensitivity FROM merge_field_definition ORDER BY code`);
  return r.rows;
}

export async function putMergeFields(fields: MergeFieldRow[], ctx: Ctx): Promise<MergeFieldRow[]> {
  await authorize(ctx, "documents", "WRITE");
  if (!Array.isArray(fields) || fields.length === 0) throw new AppError("validation", "fields must be a non-empty list", "fields");
  for (const f of fields) {
    if (!f.code?.trim() || !f.source_path?.trim()) throw new AppError("validation", "code and source_path are required", "fields");
    await db.query(
      `INSERT INTO merge_field_definition (code, source_path, type, format, required, sensitivity) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET source_path = $2, type = $3, format = $4, required = $5, sensitivity = $6`,
      [f.code.trim(), f.source_path.trim(), f.type, f.format ?? null, f.required ?? false, f.sensitivity ?? null]
    );
  }
  const codes = fields.map((f) => f.code.trim());
  return (await db.query<MergeFieldRow>(`SELECT code, source_path, type, format, required, sensitivity FROM merge_field_definition WHERE code = ANY($1::text[]) ORDER BY code`, [codes])).rows;
}
