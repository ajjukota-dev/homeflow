import { db } from "../db";
import type { DbLike } from "../events";
import { bookingFinance } from "../finance";
import { allRequiredAccepted } from "./checklist";
import { resolveTemplate, type TemplateRow } from "./templates";
import { resolveClausesForTemplate, type ClauseRow, type DslContext } from "./clauses";
import { buildSourceContext, resolvePath, type DocSourceContext } from "./source";

// 22 rule 2: the readiness panel — Ready/Warning/Blocked with named facts, checked before
// generation ever runs (p39 §32.3; p41 §32.11 t2 "generation blocked when source data incomplete").

export type ReadinessLevel = "READY" | "WARNING" | "BLOCKED";
export interface ReadinessFact { level: "INFO" | "WARNING" | "BLOCKED"; message: string }
export interface ReadinessResult {
  result: ReadinessLevel; facts: ReadinessFact[];
  template: TemplateRow | null; context: DocSourceContext | null; clauses: ClauseRow[]; missing_clause_codes: string[];
}

/** The one family-specific completeness check the spec names by name (rule 2's Sale Deed example):
 *  19 clearance for REGISTRATION + an executed AOS (legacy legal-docs.ts's own table — a deliberate
 *  cross-read, same pattern as 08 reading 24's holds) + KYC ACCEPTED. UNCONFIRMED which of these are
 *  hard-Blocked vs soft-Warning; judgment call below, flagged in the build note. */
async function saleDeedChecks(bookingId: string, tx: DbLike): Promise<ReadinessFact[]> {
  const facts: ReadinessFact[] = [];
  const finance = await bookingFinance(bookingId);
  if (!finance.cleared) facts.push({ level: "BLOCKED", message: `financial clearance not met (${Math.round(finance.paid_pct * 100)}% paid, reason: ${finance.reason})` });
  const aos = await tx.query<{ id: string }>(`SELECT id FROM generated_document WHERE booking_id = $1 AND document_family = 'AOS' AND status IN ('executed', 'archived') LIMIT 1`, [bookingId]);
  if (aos.rows.length === 0) facts.push({ level: "BLOCKED", message: "Agreement of Sale is not yet executed" });
  if (!(await allRequiredAccepted(bookingId, tx))) facts.push({ level: "WARNING", message: "KYC checklist has documents not yet ACCEPTED" });
  return facts;
}

function toDslContext(ctx: DocSourceContext): DslContext {
  return { customer: ctx.customer, booking: ctx.booking, unit: ctx.unit, project: ctx.project };
}

/** Every merge field the template's own `body_html` actually references (`{{code}}`), so
 *  readiness only blocks on fields this specific document needs — not the whole config table. */
async function referencedMergeFields(template: TemplateRow, tx: DbLike): Promise<{ code: string; required: boolean; type: string; format: string | null; source_path: string }[]> {
  const codes = [...template.body_html.matchAll(/\{\{([a-zA-Z0-9_.\[\]]+)\}\}/g)].map((m) => m[1]!);
  if (codes.length === 0) return [];
  const r = await tx.query<{ code: string; required: boolean; type: string; format: string | null; source_path: string }>(
    `SELECT code, required, type, format, source_path FROM merge_field_definition WHERE code = ANY($1::text[])`,
    [codes]
  );
  return r.rows;
}

export async function computeReadiness(bookingId: string, familyCode: string, tx: DbLike = db): Promise<ReadinessResult> {
  const facts: ReadinessFact[] = [];
  const b = await tx.query<{ project_id: string; product_type: string }>(`SELECT b.project_id, u.product_type FROM booking b JOIN unit u ON u.id = b.unit_id WHERE b.id = $1`, [bookingId]);
  const booking = b.rows[0];
  if (!booking) throw new Error("booking_not_found");

  const template = await resolveTemplate({ family_code: familyCode, project_id: booking.project_id, product_type: booking.product_type }, tx);
  if (!template) {
    return { result: "BLOCKED", facts: [{ level: "BLOCKED", message: `no APPROVED template for ${familyCode} in this project/product` }], template: null, context: null, clauses: [], missing_clause_codes: [] };
  }

  const context = await buildSourceContext(bookingId, tx);
  const fields = await referencedMergeFields(template, tx);
  for (const f of fields) {
    const value = resolvePath(context, f.source_path);
    if (f.required && (value === null || value === undefined || value === "")) facts.push({ level: "BLOCKED", message: `merge field "${f.code}" (${f.source_path}) is missing` });
  }

  const { resolved: clauses, missing_codes } = await resolveClausesForTemplate(template.id, toDslContext(context), tx);
  for (const code of missing_codes) facts.push({ level: "BLOCKED", message: `clause "${code}" has no APPROVED version` });

  if (template.family_code === "SALE_DEED") facts.push(...(await saleDeedChecks(bookingId, tx)));

  const result: ReadinessLevel = facts.some((f) => f.level === "BLOCKED") ? "BLOCKED" : facts.some((f) => f.level === "WARNING") ? "WARNING" : "READY";
  return { result, facts, template, context, clauses, missing_clause_codes: missing_codes };
}
