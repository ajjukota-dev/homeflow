import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { evaluateCondition, validateConditionExpr } from "../journey/dsl";
import { loadTemplate } from "./templates";

// 22 rule 5 (clause types + selection) + rule 10 (versioned clauses). Selection conditions reuse
// 05's DSL (journey/dsl.ts) verbatim rather than inventing a second expression language.

export type ClauseType = "LOCKED" | "PARAMETERIZED" | "NEGOTIABLE_WITH_APPROVAL";
export interface ClauseRow {
  id: string; code: string; title: string; body_html: string; category: string | null; type: ClauseType;
  parameters: Record<string, unknown>; version: number; status: "DRAFT" | "APPROVED" | "RETIRED"; approved_by: string | null; approved_at: string | null;
}
const SELECT = `SELECT id, code, title, body_html, category, type, parameters, version, status, approved_by, approved_at::text AS approved_at FROM clause`;

export async function loadClause(id: string, tx: DbLike = db): Promise<ClauseRow> {
  const r = await tx.query<ClauseRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "clause not found");
  return r.rows[0];
}

export async function listClauses(ctx: Ctx): Promise<ClauseRow[]> {
  await authorize(ctx, "documents", "READ");
  return (await db.query<ClauseRow>(`${SELECT} ORDER BY code, version DESC`)).rows;
}

/** The current (highest APPROVED, else highest DRAFT) version per code — what a template resolves against. */
async function currentClauseByCode(code: string, tx: DbLike): Promise<ClauseRow | null> {
  const r = await tx.query<ClauseRow>(`${SELECT} WHERE code = $1 ORDER BY (status = 'APPROVED') DESC, version DESC LIMIT 1`, [code]);
  return r.rows[0] ?? null;
}

export interface ClauseInput { code: string; title: string; body_html: string; category?: string | null; type: ClauseType; parameters?: Record<string, unknown> }

export async function createClause(input: ClauseInput, ctx: Ctx): Promise<ClauseRow> {
  await authorize(ctx, "documents", "WRITE");
  if (!input.code?.trim() || !input.title?.trim() || !input.body_html?.trim()) throw new AppError("validation", "code, title and body_html are required");
  const id = "cls_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO clause (id, code, title, body_html, category, type, parameters, version, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, 1 + COALESCE((SELECT MAX(version) FROM clause WHERE code = $2), 0), $8)`,
    [id, input.code.trim(), input.title.trim(), input.body_html, input.category ?? null, input.type, JSON.stringify(input.parameters ?? {}), ctx.actor.user_id]
  );
  return loadClause(id);
}

/** PUT /clauses/:id/versions/:v — DRAFT only; APPROVED/RETIRED are immutable. */
export async function updateClause(id: string, input: Partial<Pick<ClauseInput, "title" | "body_html" | "category" | "parameters">>, ctx: Ctx): Promise<ClauseRow> {
  await authorize(ctx, "documents", "WRITE");
  const c = await loadClause(id);
  if (c.status !== "DRAFT") throw new AppError("conflict", `clause is ${c.status}; create a new version instead`);
  await db.query(`UPDATE clause SET title = $2, body_html = $3, category = $4, parameters = $5::jsonb WHERE id = $1`, [
    id, input.title?.trim() || c.title, input.body_html ?? c.body_html, input.category ?? c.category, JSON.stringify(input.parameters ?? c.parameters),
  ]);
  return loadClause(id);
}

export async function approveClause(id: string, ctx: Ctx): Promise<ClauseRow> {
  await authorize(ctx, "documents", "WRITE");
  const c = await loadClause(id);
  if (c.status !== "DRAFT") throw new AppError("conflict", `clause is ${c.status}`);
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE clause SET status = 'RETIRED' WHERE code = $1 AND status = 'APPROVED' AND id <> $2`, [c.code, id]);
    await tx.query(`UPDATE clause SET status = 'APPROVED', approved_by = $2, approved_at = now() WHERE id = $1`, [id, ctx.actor.user_id]);
    await appendEvent(tx, { type: "clause.version_approved", entity_type: "clause", entity_id: id, payload: { code: c.code, version: c.version }, ...actorFields(ctx) });
  });
  return loadClause(id);
}

// --- Selection rules (template_id -> ordered clause codes with an optional DSL condition) ---
export interface ClauseSelectionRuleRow { id: string; template_id: string; clause_code: string; condition: string | null; position: number }

export async function listSelectionRules(templateId: string, ctx: Ctx): Promise<ClauseSelectionRuleRow[]> {
  await authorize(ctx, "documents", "READ");
  return (await db.query<ClauseSelectionRuleRow>(`SELECT id, template_id, clause_code, condition, position FROM clause_selection_rule WHERE template_id = $1 ORDER BY position`, [templateId])).rows;
}

/** PUT /document-templates/:id/clause-rules — replaces the full ordered list; each condition validated up front (fail-closed, same discipline as 05 rule 6). */
export async function putSelectionRules(templateId: string, rules: { clause_code: string; condition?: string | null }[], ctx: Ctx): Promise<ClauseSelectionRuleRow[]> {
  await authorize(ctx, "documents", "WRITE");
  await loadTemplate(templateId);
  for (const r of rules) {
    if (!r.clause_code?.trim()) throw new AppError("validation", "clause_code is required", "rules");
    if (r.condition) validateConditionExpr(r.condition);
  }
  await withTx(undefined, async (tx) => {
    await tx.query(`DELETE FROM clause_selection_rule WHERE template_id = $1`, [templateId]);
    let position = 0;
    for (const r of rules) {
      await tx.query(
        `INSERT INTO clause_selection_rule (id, template_id, clause_code, condition, position) VALUES ($1,$2,$3,$4,$5)`,
        ["csr_" + randomUUID().slice(0, 8), templateId, r.clause_code.trim(), r.condition ?? null, position++]
      );
    }
  });
  return listSelectionRules(templateId, ctx);
}

export interface DslContext { customer: Record<string, unknown>; booking: Record<string, unknown>; unit: Record<string, unknown>; project: Record<string, unknown> }

/** Rule 5: resolves the template's ordered clause list against a live context — clauses whose
 *  condition doesn't match are skipped; an unresolvable clause code is a Blocked readiness fact,
 *  not a silent omission (surfaced by the caller, `readiness.ts`). */
export async function resolveClausesForTemplate(templateId: string, context: DslContext, tx: DbLike = db): Promise<{ resolved: ClauseRow[]; missing_codes: string[] }> {
  const rules = await tx.query<ClauseSelectionRuleRow>(`SELECT id, template_id, clause_code, condition, position FROM clause_selection_rule WHERE template_id = $1 ORDER BY position`, [templateId]);
  const resolved: ClauseRow[] = [];
  const missing_codes: string[] = [];
  for (const rule of rules.rows) {
    if (rule.condition && !evaluateCondition(rule.condition, context)) continue;
    const clause = await currentClauseByCode(rule.clause_code, tx);
    if (!clause || clause.status !== "APPROVED") missing_codes.push(rule.clause_code);
    else resolved.push(clause);
  }
  return { resolved, missing_codes };
}
