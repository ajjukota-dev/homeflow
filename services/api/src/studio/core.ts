import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields } from "../events";
import { requireRole, STAFF_ROLES, POLICY_STUDIO_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";

// Generic Studio draft/publish/history envelope (25-policy-studio.md rules 1 + Data's
// `policy_version`). Only for flat config tables that carry NO versioning columns of their
// own — delay_reason and action_type (10) have none, so policy_version is their only source of
// history. project_calendar has none either, so it opts in too. sla_policy (06) already has its
// own effective_from/effective_to/version columns and needs bespoke draft/publish logic mirroring
// 05's journey_template_version, not this generic envelope — deferred, logged in TODO.md, tab
// stays built:false in studio/registry.ts until that's built. 05's Journey Template Studio and
// 25's own approval_authority_rule likewise keep their own dedicated modules (templates.ts,
// approvals/matrix.ts) — the matrix's overlap/gap validation doesn't fit generic column CRUD.
//
// Security: `tableName` and every column name that reaches SQL comes ONLY from this hard-coded
// registry below, never from the request — POST /studio/:table can't inject a column or table
// name that isn't already an allow-listed key/value here. Row *values* are always parameterized.
//
// Rule 5 ("every template/config row carries product_types[]"): each registered table gets a
// product_types text[] column (NULL = every product type) via 0023_policy.sql. No PLOT-specific
// row content is seeded — that's real business config for whichever spec owns it, not something
// invented here (same "don't hardcode without Amarsh's real data" call as East Crest's durations).

interface TableRegistryEntry {
  primaryKey: string;
  columns: string[]; // editable, excludes the primary key
  jsonColumns?: string[]; // subset of `columns` that are jsonb — need ::jsonb + JSON.stringify
  arrayColumns?: string[]; // subset of `columns` that are text[] — need ::text[], raw JS array
  editRoles: string[];
}

// "product_types" on every registered table is rule 5's mechanism ("every template/config row
// carries product_types[]") — NULL = applies to every product type. No PLOT-specific row content
// is seeded (see 0023_policy.sql's comment) — that's real business config, not invented here.
const PRODUCT_TYPES_COL = "product_types";

export const TABLE_REGISTRY: Record<string, TableRegistryEntry> = {
  project_calendar: { primaryKey: "id", columns: ["name", "working_days", "holidays", "timezone", PRODUCT_TYPES_COL], jsonColumns: ["working_days", "holidays"], arrayColumns: [PRODUCT_TYPES_COL], editRoles: POLICY_STUDIO_ROLES },
  delay_reason: { primaryKey: "code", columns: ["label", "category", "counts_against_sla", PRODUCT_TYPES_COL], arrayColumns: [PRODUCT_TYPES_COL], editRoles: POLICY_STUDIO_ROLES },
  action_type: { primaryKey: "code", columns: ["family", "label", "default_owner_role", "default_priority", "default_evidence_requirement", "customer_visible_default", PRODUCT_TYPES_COL], arrayColumns: [PRODUCT_TYPES_COL], editRoles: POLICY_STUDIO_ROLES },
  // 20-cash-forecast.md — none of these three carry their own versioning columns, same
  // "generic envelope" fit as project_calendar/delay_reason/action_type above.
  probability_rule: { primaryKey: "id", columns: ["source_type", "condition", "probability", "effective_from", "effective_to", "version", PRODUCT_TYPES_COL], jsonColumns: ["condition"], arrayColumns: [PRODUCT_TYPES_COL], editRoles: POLICY_STUDIO_ROLES },
  cash_target: { primaryKey: "id", columns: ["project_id", "period", "target_inr", "set_by", PRODUCT_TYPES_COL], arrayColumns: [PRODUCT_TYPES_COL], editRoles: POLICY_STUDIO_ROLES },
  period_calendar: { primaryKey: "project_id", columns: ["fiscal_year_start_month", "week_start_day", PRODUCT_TYPES_COL], arrayColumns: [PRODUCT_TYPES_COL], editRoles: POLICY_STUDIO_ROLES },
  // 26-customer-portal.md — no versioning columns of its own, same generic-envelope fit as
  // above. No product_types column: the spec's own Data row lists only entity/field/visible/
  // customer_wording (per-project via project_id already) — visibility doesn't vary by product
  // type, so PRODUCT_TYPES_COL isn't force-fit onto a row shape that doesn't ask for it.
  customer_visibility_rule: { primaryKey: "id", columns: ["entity", "field", "project_id", "visible", "customer_wording"], editRoles: POLICY_STUDIO_ROLES },
};

function columnSql(entry: TableRegistryEntry, col: string, placeholder: string): string {
  if (entry.jsonColumns?.includes(col)) return `${placeholder}::jsonb`;
  if (entry.arrayColumns?.includes(col)) return `${placeholder}::text[]`;
  return placeholder;
}

function columnValue(entry: TableRegistryEntry, col: string, value: unknown): unknown {
  return entry.jsonColumns?.includes(col) ? JSON.stringify(value) : value;
}

function requireTable(tableName: string): TableRegistryEntry {
  const entry = TABLE_REGISTRY[tableName];
  if (!entry) throw new AppError("not_found", `unknown Studio table: ${tableName}`);
  return entry;
}

export interface StudioRow { [key: string]: unknown }

/** GET /studio/:table — current live rows. `effective_on` in the past/future isn't
 *  reconstructed from policy_version history (that needs replaying diffs in order, a bigger
 *  lift deferred and logged in TODO.md) — this always returns the table's current state. */
export async function listStudioTable(tableName: string, ctx: Ctx): Promise<StudioRow[]> {
  requireRole(ctx, STAFF_ROLES); // rule 3: everyone else read-only
  const entry = requireTable(tableName);
  const cols = [entry.primaryKey, ...entry.columns].join(", ");
  const r = await db.query<StudioRow>(`SELECT ${cols} FROM ${tableName} ORDER BY ${entry.primaryKey}`);
  return r.rows;
}

/** POST /studio/:table — stage a draft (rowId null = new row, PK must be in `values`).
 *  Returns the policy_version id; nothing in the real table changes until publish. */
export async function draftStudioRow(tableName: string, rowId: string | null, values: StudioRow, note: string | undefined, ctx: Ctx): Promise<string> {
  const entry = requireTable(tableName);
  requireRole(ctx, entry.editRoles);
  const isNew = rowId === null;
  const allowedKeys = isNew ? [...entry.columns, entry.primaryKey] : entry.columns;
  for (const k of Object.keys(values)) {
    if (!allowedKeys.includes(k)) throw new AppError("validation", `${k} is not an editable column of ${tableName}`, k);
  }
  const realRowId = isNew ? (values[entry.primaryKey] as string | undefined) : rowId;
  if (!realRowId) throw new AppError("validation", `${entry.primaryKey} is required`, entry.primaryKey);

  return withTx(undefined, async (tx) => {
    const existing = await tx.query<{ v: string }>(`SELECT COALESCE(MAX(version), 0)::text AS v FROM policy_version WHERE table_name = $1 AND row_id = $2`, [tableName, realRowId]);
    const version = Number(existing.rows[0].v) + 1;
    const id = "pv_" + randomUUID().slice(0, 8);
    await tx.query(
      `INSERT INTO policy_version (id, table_name, row_id, version, changed_by, change_note, diff) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [id, tableName, realRowId, version, ctx.actor.user_id, note ?? null, JSON.stringify(values)]
    );
    return id;
  });
}

/** POST /studio/:table/:id/publish — applies the draft's diff to the real table (upsert) and
 *  writes `policy.changed` (rule 1). `id` here is the policy_version id from draftStudioRow. */
export async function publishStudioRow(tableName: string, policyVersionId: string, effectiveFrom: string, note: string | undefined, ctx: Ctx): Promise<void> {
  const entry = requireTable(tableName);
  requireRole(ctx, entry.editRoles);
  await withTx(undefined, async (tx) => {
    const pv = await tx.query<{ row_id: string; diff: StudioRow; version: number; effective_from: string | null }>(
      `SELECT row_id, diff, version, effective_from::text AS effective_from FROM policy_version WHERE id = $1 AND table_name = $2`,
      [policyVersionId, tableName]
    );
    if (!pv.rows[0]) throw new AppError("not_found", "draft not found");
    if (pv.rows[0].effective_from) throw new AppError("conflict", "already published");
    const { row_id: rowId, diff } = pv.rows[0];
    const cols = Object.keys(diff).filter((c) => c !== entry.primaryKey && entry.columns.includes(c));

    const exists = await tx.query(`SELECT 1 FROM ${tableName} WHERE ${entry.primaryKey} = $1`, [rowId]);
    if (!exists.rows[0]) {
      const allCols = [entry.primaryKey, ...cols];
      const placeholders = [`$1`, ...cols.map((c, i) => columnSql(entry, c, `$${i + 2}`))].join(", ");
      await tx.query(`INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${placeholders})`, [rowId, ...cols.map((c) => columnValue(entry, c, diff[c]))]);
    } else if (cols.length > 0) {
      const sets = cols.map((c, i) => `${c} = ${columnSql(entry, c, `$${i + 2}`)}`).join(", ");
      await tx.query(`UPDATE ${tableName} SET ${sets} WHERE ${entry.primaryKey} = $1`, [rowId, ...cols.map((c) => columnValue(entry, c, diff[c]))]);
    }
    await tx.query(`UPDATE policy_version SET effective_from = $2, change_note = COALESCE($3, change_note) WHERE id = $1`, [policyVersionId, effectiveFrom, note ?? null]);
    await appendEvent(tx, {
      type: "policy.changed",
      entity_type: tableName,
      entity_id: rowId,
      payload: { table_name: tableName, version: pv.rows[0].version, note: note ?? null },
      ...actorFields(ctx),
    });
  });
}

export async function studioRowHistory(tableName: string, rowId: string, ctx: Ctx): Promise<StudioRow[]> {
  requireTable(tableName);
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<StudioRow>(
    `SELECT id, version, effective_from::text AS effective_from, effective_to::text AS effective_to, changed_by, changed_at::text AS changed_at, change_note, diff
       FROM policy_version WHERE table_name = $1 AND row_id = $2 ORDER BY version`,
    [tableName, rowId]
  );
  return r.rows;
}

/** POST /studio/:table/preview — rule 4's "dry-run how many units/actions change." Genuinely
 *  computable for none of this segment's three registered tables (project_calendar/delay_reason/
 *  action_type edits don't have an obvious "N rows affected" count the way an sla_policy duration
 *  change would against open sla_clock rows) — refusing explicitly rather than shipping a stub
 *  that always says "0 affected", which would be indistinguishable from a real zero-impact result. */
export async function previewStudioChange(tableName: string): Promise<never> {
  requireTable(tableName);
  throw new AppError("validation", `preview-impact is not implemented for ${tableName} yet — see TODO.md`);
}
