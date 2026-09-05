import { db } from "../db";
import { requireRole } from "../authz/requireRole";
import type { Ctx } from "../authz/types";
import { loadCr, listCrItems } from "./store";
import { CUSTOMISATION_DESK_ROLES } from "./capture";

// 18 rule 10: profitability per CR = price - vendor cost - tax - waivers = contribution.
// "Aggregated per project (27)" — 27 (management control tower) isn't built; this exports the
// per-CR figure any future 27 rollup can sum, same "carries what a future consumer needs, no
// rollup computed here" treatment 19's own waiver table already used for the same reason.

export interface CrEconomics {
  cr_id: string; code: string; price_inr: number; vendor_cost_inr: number; tax_inr: number; waiver_inr: number; contribution_inr: number;
}

export async function getCrEconomics(crId: string, ctx: Ctx): Promise<CrEconomics> {
  requireRole(ctx, [...CUSTOMISATION_DESK_ROLES, "MANAGEMENT", "SUPER_ADMIN"]);
  const cr = await loadCr(crId);
  const items = await listCrItems(crId);
  const price = items.reduce((s, it) => s + it.qty * it.unit_price_inr, 0);
  const vendorCost = items.reduce((s, it) => s + it.qty * it.vendor_cost_inr, 0);
  const q = cr.quotation_id ? (await db.query<{ tax_inr: number; waiver_inr: number }>(`SELECT tax_inr::float8 AS tax_inr, waiver_inr::float8 AS waiver_inr FROM quotation WHERE id = $1`, [cr.quotation_id])).rows[0] : null;
  const tax = q?.tax_inr ?? 0;
  const waiver = q?.waiver_inr ?? 0;
  return { cr_id: crId, code: cr.code, price_inr: price, vendor_cost_inr: vendorCost, tax_inr: tax, waiver_inr: waiver, contribution_inr: price - vendorCost - tax - waiver };
}

export async function listProjectEconomics(projectId: string, ctx: Ctx): Promise<CrEconomics[]> {
  requireRole(ctx, ["MANAGEMENT", "SUPER_ADMIN"]);
  const rows = await db.query<{ id: string }>(`SELECT id FROM change_request WHERE project_id = $1 AND status NOT IN ('WITHDRAWN','CANCELLED','REJECTED')`, [projectId]);
  return Promise.all(rows.rows.map((r) => getCrEconomics(r.id, ctx)));
}
