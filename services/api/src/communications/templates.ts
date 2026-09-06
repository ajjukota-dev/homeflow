import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields } from "../events";
import { authorize } from "../authz/authorize";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { buildSourceContext, resolvePath, formatMergeValue } from "../documents/source";

// 29-communications.md rule 3 — DRAFT -> LEGAL_REVIEW -> APPROVED -> RETIRED, same versioning
// shape as 22's doc_factory_template (`code` is a family key, not a generated sequence code;
// multiple version rows share it). Reuses 22's own `merge_field_definition`/`buildSourceContext`/
// `resolvePath`/`formatMergeValue` for `{{code}}` rendering — communications don't need 22's
// clause/PDF machinery (a plain-text/HTML email or logged note, not a legal document), so this
// file does its own lightweight substitution rather than routing through `documents/generate.ts`.

export type TemplatePurpose = "WELCOME" | "PAYMENT_REMINDER" | "MILESTONE" | "DOCUMENT_REQUEST" | "APPOINTMENT" | "DELAY_NOTICE" | "CUSTOMISATION_QUOTE" | "HANDOVER_INVITE" | "CHECK_IN" | "GENERAL";
export type TemplateChannel = "CALL" | "EMAIL" | "WHATSAPP" | "SMS" | "MEETING" | "NOTICE" | "PORTAL_UPDATE";
export type TemplateStatus = "DRAFT" | "LEGAL_REVIEW" | "APPROVED" | "RETIRED";

// Rule 3: "payment reminders, delay notices, cancellation require Legal approval" — cancellation
// has no purpose value of its own in the Data table's enum (flagged, not invented); the two real
// enum values named are wired here.
const LEGAL_BEARING_PURPOSES: TemplatePurpose[] = ["PAYMENT_REMINDER", "DELAY_NOTICE"];

export interface CommunicationTemplateRow {
  id: string; code: string; channel: TemplateChannel; purpose: TemplatePurpose; subject: string | null; body: string;
  project_id: string | null; version: number; status: TemplateStatus; approved_by: string | null; approved_at: string | null; created_at: string;
}
const SELECT = `SELECT id, code, channel, purpose, subject, body, project_id, version, status,
  approved_by, approved_at::text AS approved_at, created_at::text AS created_at FROM communication_template`;

export async function loadCommunicationTemplate(id: string): Promise<CommunicationTemplateRow> {
  const r = await db.query<CommunicationTemplateRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "communication template not found");
  return r.rows[0];
}

export async function listCommunicationTemplates(filter: { channel?: string; purpose?: string; project_id?: string }, ctx: Ctx): Promise<CommunicationTemplateRow[]> {
  await authorize(ctx, "communications", "READ");
  const r = await db.query<CommunicationTemplateRow>(
    `${SELECT} WHERE ($1::text IS NULL OR channel = $1) AND ($2::text IS NULL OR purpose = $2) AND (project_id IS NULL OR project_id = $3)
       ORDER BY code, project_id NULLS LAST, version DESC`,
    [filter.channel ?? null, filter.purpose ?? null, filter.project_id ?? null]
  );
  return r.rows;
}

export interface TemplateInput { code: string; channel: TemplateChannel; purpose: TemplatePurpose; subject?: string | null; body: string; project_id?: string | null }

/** POST /communication-templates — a new DRAFT version (1 + highest existing for this code/scope). */
export async function createCommunicationTemplate(input: TemplateInput, ctx: Ctx): Promise<CommunicationTemplateRow> {
  await authorize(ctx, "communications", "WRITE");
  if (!input.code?.trim() || !input.body?.trim()) throw new AppError("validation", "code and body are required");
  const id = "ctpl_" + randomUUID().slice(0, 8);
  const projectId = input.project_id ?? null;
  await db.query(
    `INSERT INTO communication_template (id, code, channel, purpose, subject, body, project_id, version, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       1 + COALESCE((SELECT MAX(version) FROM communication_template WHERE code = $2 AND COALESCE(project_id,'') = COALESCE($7,'')), 0),
       $8)`,
    [id, input.code.trim(), input.channel, input.purpose, input.subject ?? null, input.body, projectId, ctx.actor.user_id]
  );
  return loadCommunicationTemplate(id);
}

/** POST …/submit-legal-review — DRAFT -> LEGAL_REVIEW. */
export async function submitTemplateForLegalReview(id: string, ctx: Ctx): Promise<CommunicationTemplateRow> {
  await authorize(ctx, "communications", "WRITE");
  const t = await loadCommunicationTemplate(id);
  if (t.status !== "DRAFT") throw new AppError("conflict", `template is ${t.status}`);
  await db.query(`UPDATE communication_template SET status = 'LEGAL_REVIEW', updated_at = now() WHERE id = $1`, [id]);
  return loadCommunicationTemplate(id);
}

/** POST …/approve — rule 3's dual approver: Legal for legal-bearing purposes (payment reminders,
 *  delay notices), CRM lead otherwise — modeled as the CRM role directly, same "named seniority
 *  has no dedicated role value" simplification 20's forecast/18's approval matrix already apply.
 *  Retires the previously APPROVED version of the same code/scope, same rule 10 pattern as 22. */
export async function approveCommunicationTemplate(id: string, ctx: Ctx): Promise<CommunicationTemplateRow> {
  const t = await loadCommunicationTemplate(id);
  const approverRoles = LEGAL_BEARING_PURPOSES.includes(t.purpose) ? ["LEGAL", "SUPER_ADMIN"] : ["CRM", "MANAGEMENT", "SUPER_ADMIN"];
  requireRole(ctx, approverRoles);
  if (t.status !== "LEGAL_REVIEW") throw new AppError("conflict", `template is ${t.status}, submit for review first`);
  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE communication_template SET status = 'RETIRED', updated_at = now()
        WHERE code = $1 AND COALESCE(project_id,'') = COALESCE($2,'') AND status = 'APPROVED' AND id <> $3`,
      [t.code, t.project_id, id]
    );
    await tx.query(`UPDATE communication_template SET status = 'APPROVED', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`, [id, ctx.actor.user_id]);
    await appendEvent(tx, {
      type: "template.approved", entity_type: "communication_template", entity_id: id, project_id: t.project_id ?? undefined,
      payload: { code: t.code, version: t.version, purpose: t.purpose }, ...actorFields(ctx),
    });
  });
  return loadCommunicationTemplate(id);
}

/** Rule 3: "the APPROVED template" for a purpose/channel/scope — a project-scoped row beats the
 *  standard (NULL project) one, same resolution shape as 22's `resolveTemplate`. */
export async function resolveCommunicationTemplate(input: { purpose: TemplatePurpose; channel: TemplateChannel; project_id: string }): Promise<CommunicationTemplateRow | null> {
  const r = await db.query<CommunicationTemplateRow>(
    `${SELECT} WHERE purpose = $1 AND channel = $2 AND status = 'APPROVED' AND (project_id = $3 OR project_id IS NULL)
       ORDER BY (project_id IS NULL) ASC, version DESC LIMIT 1`,
    [input.purpose, input.channel, input.project_id]
  );
  return r.rows[0] ?? null;
}

/** Rule 3's "merge fields resolve from 22 definitions; preview before send" — a plain `{{code}}`
 *  substitution against a booking's live context, no clause/PDF machinery. Returns the codes that
 *  had no matching `merge_field_definition` row (left as literal `{{code}}` in the output) so a
 *  caller can flag them in the preview rather than silently ship a template with an unresolved slot. */
export async function renderTemplateBody(bodyOrSubject: string, bookingId: string): Promise<{ text: string; unresolved: string[] }> {
  const codes = [...new Set([...bodyOrSubject.matchAll(/\{\{([a-zA-Z0-9_.\[\]]+)\}\}/g)].map((m) => m[1]!))];
  if (codes.length === 0) return { text: bodyOrSubject, unresolved: [] };
  const context = await buildSourceContext(bookingId);
  const fields = (await db.query<{ code: string; source_path: string; type: string; format: string | null }>(
    `SELECT code, source_path, type, format FROM merge_field_definition WHERE code = ANY($1::text[])`,
    [codes]
  )).rows;
  const byCode = new Map(fields.map((f) => [f.code, f]));
  const unresolved: string[] = [];
  const text = bodyOrSubject.replace(/\{\{([a-zA-Z0-9_.\[\]]+)\}\}/g, (whole, code) => {
    const f = byCode.get(code);
    if (!f) { unresolved.push(code); return whole; }
    return formatMergeValue(resolvePath(context, f.source_path), f.type, f.format);
  });
  return { text, unresolved };
}
