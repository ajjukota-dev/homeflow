import { randomUUID, createHash } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { nextCode } from "../model/codes";
import { pdf } from "../pdf";
import { files } from "../ports/files";
import { computeReadiness, type ReadinessResult } from "./readiness";
import { resolvePath, formatMergeValue } from "./source";
import type { ClauseRow } from "./clauses";
import { loadDocument, type DocumentRow, type RedlineSummary, type SelectedClause } from "./store";
import { approvedDeviations, carryForwardDeviation } from "./deviations";

// 22 rules 1-4: generate only from an APPROVED template past readiness; freeze data_snapshot;
// version+1 + redline + supersede on regeneration; draft watermark until execution.
export { loadDocument, type DocumentRow };

/** Pure (rule 3's "field/clauses changed"). */
export function computeRedline(prevSnapshot: Record<string, unknown>, nextSnapshot: Record<string, unknown>, prevClauseCodes: string[], nextClauseCodes: string[]): RedlineSummary {
  const fields_changed = [...new Set([...Object.keys(prevSnapshot), ...Object.keys(nextSnapshot)])].filter((k) => JSON.stringify(prevSnapshot[k]) !== JSON.stringify(nextSnapshot[k]));
  return {
    fields_changed,
    clauses_added: nextClauseCodes.filter((c) => !prevClauseCodes.includes(c)),
    clauses_removed: prevClauseCodes.filter((c) => !nextClauseCodes.includes(c)),
  };
}

function renderHtml(bodyHtml: string, snapshot: Record<string, unknown>, clauses: { code: string; body_html: string }[]): string {
  let html = bodyHtml.replace(/\{\{clause:([A-Za-z0-9_]+)\}\}/g, (_, code) => clauses.find((c) => c.code === code)?.body_html ?? "");
  html = html.replace(/\{\{([a-zA-Z0-9_.\[\]]+)\}\}/g, (_, code) => (snapshot[code] !== undefined ? String(snapshot[code]) : ""));
  return html;
}

export interface GenerateInput { template_id?: string; clause_params?: Record<string, Record<string, unknown>> }

/** Rules 1-4: readiness-gated generation. Blocked readiness throws (400 via failHttp); the
 *  caller should check `GET .../readiness` first, same as 15's `incomplete` pattern. Rule 5: an
 *  approved deviation against the PRIOR version's document is applied to that clause's body on
 *  this regeneration (selected_clauses is frozen per-version, never mutated in place). */
export async function generateDocument(bookingId: string, familyCode: string, input: GenerateInput, ctx: Ctx): Promise<DocumentRow> {
  await authorize(ctx, "documents", "WRITE");
  const readiness: ReadinessResult = await computeReadiness(bookingId, familyCode, db);
  if (readiness.result === "BLOCKED") {
    throw new AppError("conflict", `generation blocked: ${readiness.facts.filter((f) => f.level === "BLOCKED").map((f) => f.message).join("; ")}`);
  }
  const template = readiness.template!;
  if (input.template_id && input.template_id !== template.id) throw new AppError("validation", "template_id does not match the resolved template for this family/scope", "template_id");

  for (const clause of readiness.clauses) {
    if (clause.type === "LOCKED" && input.clause_params?.[clause.code]) throw new AppError("validation", `clause ${clause.code} is LOCKED and cannot be parameterized`, "clause_params");
  }

  const bookingRow = (await db.query<{ unit_id: string; customer_id: string | null }>(
    `SELECT b.unit_id, ba.customer_id FROM booking b LEFT JOIN booking_applicant ba ON ba.booking_id = b.id AND ba.role = 'primary' WHERE b.id = $1`,
    [bookingId]
  )).rows[0]!;

  return withTx(undefined, async (tx) => {
    const prev = await tx.query<{ id: string; data_snapshot: Record<string, unknown>; selected_clauses: SelectedClause[] }>(
      `SELECT id, data_snapshot, selected_clauses FROM doc_factory_document WHERE booking_id = $1 AND family_code = $2 AND status NOT IN ('REJECTED','SUPERSEDED') ORDER BY version DESC LIMIT 1`,
      [bookingId, familyCode]
    );
    const priorDeviations = prev.rows[0] ? await approvedDeviations(prev.rows[0].id, tx) : [];
    const deviationByClause = new Map(priorDeviations.map((d) => [d.clause_code, d.proposed]));
    const selectedClauses: SelectedClause[] = readiness.clauses.map((c: ClauseRow) => ({
      code: c.code, title: c.title, type: c.type,
      body_html: deviationByClause.get(c.code) ?? c.body_html,
      parameters: c.type === "PARAMETERIZED" ? { ...c.parameters, ...(input.clause_params?.[c.code] ?? {}) } : c.parameters,
    }));

    const codes = [...template.body_html.matchAll(/\{\{([a-zA-Z0-9_.\[\]]+)\}\}/g)].map((m) => m[1]!);
    const fieldDefs = codes.length
      ? (await tx.query<{ code: string; source_path: string; type: string; format: string | null }>(`SELECT code, source_path, type, format FROM merge_field_definition WHERE code = ANY($1::text[])`, [codes])).rows
      : [];
    const snapshot: Record<string, unknown> = {};
    for (const f of fieldDefs) snapshot[f.code] = formatMergeValue(resolvePath(readiness.context!, f.source_path), f.type, f.format);

    const nextVersion = (await tx.query<{ n: number }>(`SELECT 1 + COALESCE(MAX(version), 0)::int AS n FROM doc_factory_document WHERE booking_id = $1 AND family_code = $2`, [bookingId, familyCode])).rows[0]!.n;

    const id = "gdoc_" + randomUUID().slice(0, 8);
    const code = await nextCode(tx, "DOC");
    const html = renderHtml(template.body_html, snapshot, selectedClauses);
    const buffer = await pdf.render(html);
    const checksum = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const projectId = readiness.context!.project.id as string;
    const pdfKey = `project/${projectId}/doc_factory_document/${id}/${code}.pdf`;
    await files.putBuffer(pdfKey, buffer, "application/pdf");

    const redline_summary = prev.rows[0] ? computeRedline(prev.rows[0].data_snapshot, snapshot, prev.rows[0].selected_clauses.map((c) => c.code), selectedClauses.map((c) => c.code)) : null;

    await tx.query(
      `INSERT INTO doc_factory_document (id, code, family_code, template_id, booking_id, unit_id, customer_id, project_id, data_snapshot, selected_clauses, version, pdf_file_key, checksum, redline_summary, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb,$15)`,
      [id, code, familyCode, template.id, bookingId, bookingRow.unit_id, bookingRow.customer_id, projectId,
        JSON.stringify(snapshot), JSON.stringify(selectedClauses), nextVersion, pdfKey, checksum, redline_summary ? JSON.stringify(redline_summary) : null, ctx.actor.user_id]
    );
    if (prev.rows[0]) {
      await tx.query(`UPDATE doc_factory_document SET status = 'SUPERSEDED', superseded_by_id = $2, updated_at = now() WHERE id = $1`, [prev.rows[0].id, id]);
    }
    for (const dev of priorDeviations) await carryForwardDeviation(id, dev, tx);
    await appendEvent(tx, {
      type: "document.generated", entity_type: "doc_factory_document", entity_id: id, project_id: projectId, booking_id: bookingId,
      payload: { family_code: familyCode, version: nextVersion, redline: redline_summary }, ...actorFields(ctx),
    });
    if (prev.rows[0]) {
      await appendEvent(tx, { type: "document.version_created", entity_type: "doc_factory_document", entity_id: id, booking_id: bookingId, payload: { family_code: familyCode, version: nextVersion, previous_id: prev.rows[0].id }, ...actorFields(ctx) });
    }
    return loadDocument(id, tx);
  });
}
