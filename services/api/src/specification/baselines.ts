import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole, SITE_SETUP_ROLES, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";

// 09-specification-revisions.md: specification baselines (Policy Studio tab) and rule 1's
// attach-at-booking-confirmation. Edit roles follow the Studio registry row (SITE + SUPER_ADMIN,
// MANAGEMENT via SITE_SETUP_ROLES); reads are any staff role.

/** category → spec text, brand/model, qty. A revision delta uses the same shape with `null` = removed. */
export type SpecItem = { spec: string; brand_model?: string | null; qty?: number | null };
export type SpecItems = Record<string, SpecItem>;
export type SpecItemsDelta = Record<string, SpecItem | null>;

export interface BaselineRow {
  id: string; project_id: string; product_type: string; unit_type: string | null; name: string; version: number;
  items: SpecItems; status: "DRAFT" | "APPROVED" | "RETIRED"; approved_by: string | null; approved_at: string | null; created_at: string;
}
const SELECT = `SELECT id, project_id, product_type, unit_type, name, version, items, status, approved_by, approved_at::text AS approved_at, created_at::text AS created_at FROM specification_baseline`;

export async function loadBaseline(id: string, tx: DbLike = db): Promise<BaselineRow> {
  const r = await tx.query<BaselineRow>(`${SELECT} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "specification baseline not found");
  return r.rows[0];
}

export async function listBaselines(projectId: string | undefined, ctx: Ctx): Promise<BaselineRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<BaselineRow>(`${SELECT} ${projectId ? "WHERE project_id = $1" : ""} ORDER BY project_id, product_type, unit_type NULLS FIRST, version DESC`, projectId ? [projectId] : []);
  return r.rows;
}

function assertItems(items: unknown): SpecItems {
  if (!items || typeof items !== "object" || Array.isArray(items)) throw new AppError("validation", "items must be an object keyed by category", "items");
  for (const [k, v] of Object.entries(items as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || typeof (v as SpecItem).spec !== "string") throw new AppError("validation", `item ${k} needs a spec text`, "items");
  }
  return items as SpecItems;
}

/** POST /specification-baselines — a new DRAFT; version = 1 + highest for the same project/product/unit_type. */
export async function createBaseline(input: { project_id: string; product_type: string; unit_type?: string | null; name: string; items: SpecItems }, ctx: Ctx): Promise<BaselineRow> {
  requireRole(ctx, SITE_SETUP_ROLES);
  if (!input.project_id || !input.product_type || !input.name?.trim()) throw new AppError("validation", "project_id, product_type and name are required");
  const items = assertItems(input.items ?? {});
  const id = "sb_" + randomUUID().slice(0, 8);
  const unitType = input.unit_type?.trim() || null;
  await db.query(
    `INSERT INTO specification_baseline (id, project_id, product_type, unit_type, name, version, items, created_by)
     VALUES ($1,$2,$3,$4,$5,
       1 + COALESCE((SELECT MAX(version) FROM specification_baseline WHERE project_id = $2 AND product_type = $3 AND COALESCE(unit_type,'') = COALESCE($4,'')), 0),
       $6::jsonb, $7)`,
    [id, input.project_id, input.product_type, unitType, input.name.trim(), JSON.stringify(items), ctx.actor.user_id]
  );
  return loadBaseline(id);
}

/** PUT /specification-baselines/:id — DRAFT only; approved baselines are immutable (revise via a new version). */
export async function updateBaseline(id: string, input: { name?: string; items?: SpecItems }, ctx: Ctx): Promise<BaselineRow> {
  requireRole(ctx, SITE_SETUP_ROLES);
  const b = await loadBaseline(id);
  if (b.status !== "DRAFT") throw new AppError("conflict", `baseline is ${b.status}; create a new version instead`);
  const items = input.items === undefined ? b.items : assertItems(input.items);
  await db.query(`UPDATE specification_baseline SET name = $2, items = $3::jsonb, updated_at = now() WHERE id = $1`, [id, input.name?.trim() || b.name, JSON.stringify(items)]);
  return loadBaseline(id);
}

/** POST /specification-baselines/:id/approve — retires the previously APPROVED baseline of the same scope. */
export async function approveBaseline(id: string, ctx: Ctx): Promise<BaselineRow> {
  requireRole(ctx, SITE_SETUP_ROLES);
  const b = await loadBaseline(id);
  if (b.status !== "DRAFT") throw new AppError("conflict", `baseline is ${b.status}`);
  if (Object.keys(b.items).length === 0) throw new AppError("validation", "an empty baseline cannot be approved", "items");
  await withTx(undefined, async (tx) => {
    const retired = await tx.query<{ id: string }>(
      `UPDATE specification_baseline SET status = 'RETIRED', updated_at = now()
        WHERE project_id = $1 AND product_type = $2 AND COALESCE(unit_type,'') = COALESCE($3,'') AND status = 'APPROVED' AND id <> $4 RETURNING id`,
      [b.project_id, b.product_type, b.unit_type, id]
    );
    await tx.query(`UPDATE specification_baseline SET status = 'APPROVED', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`, [id, ctx.actor.user_id]);
    await appendEvent(tx, {
      type: "specification.baseline_approved", entity_type: "specification_baseline", entity_id: id, project_id: b.project_id,
      payload: { name: b.name, version: b.version, product_type: b.product_type, unit_type: b.unit_type, retired: retired.rows.map((r) => r.id) }, ...actorFields(ctx),
    });
  });
  return loadBaseline(id);
}

/** Rule 1's lookup: the APPROVED baseline for the unit's project/product type; a unit_type-specific row beats the generic (NULL) one. */
export async function resolveBaseline(unit: { project_id: string; product_type: string; unit_type: string | null }, tx: DbLike = db): Promise<BaselineRow | null> {
  const r = await tx.query<BaselineRow>(
    `${SELECT} WHERE project_id = $1 AND product_type = $2 AND status = 'APPROVED' AND (unit_type = $3 OR unit_type IS NULL)
      ORDER BY (unit_type IS NULL) ASC, version DESC LIMIT 1`,
    [unit.project_id, unit.product_type, unit.unit_type]
  );
  return r.rows[0] ?? null;
}
