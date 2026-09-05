import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { loadCr, listCrItems, loadPolicy, type CrItemRow } from "./store";
import { CUSTOMISATION_DESK_ROLES } from "./capture";

// 18 rule 3: costing — line items priced from the variation catalogue (09) or bespoke with
// vendor cost; impact is mandatory (all four dimensions) before COSTING -> AWAITING_APPROVAL.

export interface ItemInput { room?: string | null; trade?: string | null; category_code: string; catalogue_item_id?: string | null; description?: string; qty?: number; unit_price_inr?: number; vendor_cost_inr?: number; tax_pct?: number; lead_days?: number }

async function assertCosting(crId: string): Promise<Awaited<ReturnType<typeof loadCr>>> {
  const cr = await loadCr(crId);
  if (cr.status !== "COSTING") throw new AppError("conflict", `change request is ${cr.status}, not COSTING`);
  return cr;
}

/** PUT: the complete desired item list for this CR (replace, like 25's studio envelopes). */
export async function putCrItems(crId: string, items: ItemInput[], ctx: Ctx): Promise<CrItemRow[]> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await assertCosting(crId);
  const policy = await loadPolicy(cr.project_id);
  if (!Array.isArray(items) || items.length === 0) throw new AppError("validation", "items must be a non-empty list", "items");

  return withTx(undefined, async (tx) => {
    await tx.query(`DELETE FROM change_request_item WHERE cr_id = $1`, [crId]);
    for (const it of items) {
      if (!it.category_code) throw new AppError("validation", "category_code is required", "items");
      let unitPrice = it.unit_price_inr ?? 0, vendorCost = it.vendor_cost_inr ?? 0, leadDays = it.lead_days ?? 0, description = it.description ?? "";
      if (it.catalogue_item_id) {
        const c = (await tx.query<{ name: string; unit_price_inr: number; vendor_cost_inr: number; lead_days: number }>(
          `SELECT name, unit_price_inr::float8 AS unit_price_inr, vendor_cost_inr::float8 AS vendor_cost_inr, lead_days FROM variation_catalogue_item WHERE id = $1 AND active`,
          [it.catalogue_item_id]
        )).rows[0];
        if (!c) throw new AppError("validation", `unknown or inactive catalogue item ${it.catalogue_item_id}`, "items");
        unitPrice = c.unit_price_inr; vendorCost = c.vendor_cost_inr; leadDays = c.lead_days; description = description || c.name;
      } else if (policy.allowed_catalogue_only) {
        throw new AppError("validation", "this project allows catalogue items only — bespoke line items are not permitted", "items");
      }
      if (!description.trim()) throw new AppError("validation", "description is required for a bespoke item", "items");
      const gateState = cr.gate_summary_at_request[it.category_code] ?? null;
      await tx.query(
        `INSERT INTO change_request_item (id, cr_id, room, trade, category_code, catalogue_item_id, description, qty, unit_price_inr, vendor_cost_inr, tax_pct, lead_days, gate_state_at_request)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        ["cri_" + randomUUID().slice(0, 8), crId, it.room ?? null, it.trade ?? null, it.category_code, it.catalogue_item_id ?? null, description.trim(),
          it.qty ?? 1, unitPrice, vendorCost, it.tax_pct ?? 0, leadDays, gateState]
      );
    }
    return listCrItems(crId, tx);
  });
}

export interface ImpactInput { cost_inr: number; schedule_days: number; technical_risk: "LOW" | "MEDIUM" | "HIGH"; handover_impact: "NONE" | "DELAYS_HANDOVER" | "BLOCKS_HANDOVER"; notes: string }

/** Rule 3: mandatory impact assessment, all four dimensions. */
export async function setImpact(crId: string, input: ImpactInput, ctx: Ctx): Promise<void> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await assertCosting(crId);
  if (input.cost_inr === undefined || input.schedule_days === undefined || !input.technical_risk || !input.handover_impact) {
    throw new AppError("validation", "impact requires cost_inr, schedule_days, technical_risk and handover_impact (all four dimensions)", "impact");
  }
  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE change_request SET impact = $2::jsonb, updated_at = now() WHERE id = $1`, [crId, JSON.stringify(input)]);
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { impact_recorded: true }, ...actorFields(ctx) });
  });
}

/** Pure: line total per item (qty * unit_price * (1 + tax_pct/100)). */
export function lineTotal(item: Pick<CrItemRow, "qty" | "unit_price_inr" | "tax_pct">): number {
  return Math.round(item.qty * item.unit_price_inr * (1 + item.tax_pct / 100));
}

/** Rule 1's "EXCEPTION_ONLY requires a unit_gate_exception (08) before COSTING" needs the CR to
 *  actually carry that exception's id — nothing in the Data table's transitions writes it, so
 *  this is the missing link a staff member calls after granting one via 08's own grantException. */
export async function linkGateException(crId: string, exceptionId: string, ctx: Ctx): Promise<void> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await assertCosting(crId);
  const ex = (await db.query<{ unit_id: string; category_code: string; status: string }>(`SELECT unit_id, category_code, status FROM unit_gate_exception WHERE id = $1`, [exceptionId])).rows[0];
  if (!ex) throw new AppError("not_found", "exception not found");
  if (ex.unit_id !== cr.unit_id) throw new AppError("validation", "that exception is for a different unit", "exception_id");
  if (ex.status !== "ACTIVE") throw new AppError("conflict", `exception is ${ex.status}, not ACTIVE`);
  await db.query(`UPDATE change_request SET exception_id = $2, updated_at = now() WHERE id = $1`, [crId, exceptionId]);
}
