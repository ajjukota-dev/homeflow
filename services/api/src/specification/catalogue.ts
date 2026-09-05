import { randomUUID } from "node:crypto";
import { db } from "../db";
import { requireRole, SITE_SETUP_ROLES, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";

// 09 variation catalogue (Policy Studio tab; 18 prices change-request line items from it).
// A project row (same code) overrides the standard (NULL project) row, like 08's rules.

export interface CatalogueItem {
  id: string; project_id: string | null; category_code: string; code: string; name: string; description: string | null;
  unit_price_inr: number; vendor_cost_inr: number; lead_days: number; product_types: string[]; constraints: Record<string, unknown>; active: boolean;
}
const SELECT = `SELECT id, project_id, category_code, code, name, description, unit_price_inr::float8 AS unit_price_inr, vendor_cost_inr::float8 AS vendor_cost_inr, lead_days, product_types, constraints, active FROM variation_catalogue_item`;

export async function listCatalogue(filter: { project_id?: string; category_code?: string; include_inactive?: boolean }, ctx: Ctx): Promise<CatalogueItem[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<CatalogueItem>(
    `${SELECT} WHERE (project_id IS NULL OR project_id = $1) AND ($2::text IS NULL OR category_code = $2) AND ($3::boolean OR active)
      ORDER BY category_code, code, (project_id IS NULL) ASC`,
    [filter.project_id ?? null, filter.category_code ?? null, filter.include_inactive ?? false]
  );
  // project row wins over the standard row with the same code
  const byCode = new Map<string, CatalogueItem>();
  for (const row of r.rows) if (!byCode.has(row.code) || row.project_id) byCode.set(row.code, row);
  return [...byCode.values()];
}

export type CatalogueInput = Omit<CatalogueItem, "id"> & { id?: string };

/** PUT /variation-catalogue — upsert by (project scope, code). */
export async function putCatalogue(items: CatalogueInput[], ctx: Ctx): Promise<CatalogueItem[]> {
  requireRole(ctx, SITE_SETUP_ROLES);
  if (!Array.isArray(items) || items.length === 0) throw new AppError("validation", "items must be a non-empty list", "items");
  const ids: string[] = [];
  for (const it of items) {
    if (!it.code?.trim() || !it.name?.trim() || !it.category_code) throw new AppError("validation", "code, name and category_code are required", "items");
    if (!(Number(it.unit_price_inr) >= 0) || !(Number(it.vendor_cost_inr ?? 0) >= 0) || !(Number(it.lead_days ?? 0) >= 0)) throw new AppError("validation", `${it.code}: price, vendor cost and lead days must be ≥ 0`, "items");
    const cat = await db.query(`SELECT 1 FROM change_category WHERE code = $1`, [it.category_code]);
    if (cat.rows.length === 0) throw new AppError("validation", `unknown category ${it.category_code}`, "items");
    const existing = await db.query<{ id: string }>(`SELECT id FROM variation_catalogue_item WHERE COALESCE(project_id, '*') = COALESCE($1, '*') AND code = $2`, [it.project_id ?? null, it.code.trim()]);
    const id = existing.rows[0]?.id ?? "vci_" + randomUUID().slice(0, 8);
    await db.query(
      `INSERT INTO variation_catalogue_item (id, project_id, category_code, code, name, description, unit_price_inr, vendor_cost_inr, lead_days, product_types, constraints, active, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11::jsonb,$12,$13)
       ON CONFLICT (id) DO UPDATE SET category_code = $3, name = $5, description = $6, unit_price_inr = $7, vendor_cost_inr = $8, lead_days = $9,
         product_types = $10::text[], constraints = $11::jsonb, active = $12, updated_by = $13, updated_at = now()`,
      [id, it.project_id ?? null, it.category_code, it.code.trim(), it.name.trim(), it.description ?? null, Number(it.unit_price_inr), Number(it.vendor_cost_inr ?? 0), Number(it.lead_days ?? 0),
        it.product_types ?? [], JSON.stringify(it.constraints ?? {}), it.active ?? true, ctx.actor.user_id]
    );
    ids.push(id);
  }
  return (await db.query<CatalogueItem>(`${SELECT} WHERE id = ANY($1::text[]) ORDER BY category_code, code`, [ids])).rows;
}
