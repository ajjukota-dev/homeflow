import { db } from "../db";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { toSpecUnitSaleStatus } from "../model/status";
import { evaluateUnit, type GateView } from "../changeability/core";
import { unitReadiness } from "../qa";
import { unitsInScope } from "../progress/core";
import type { ProgressState } from "../gates";
import { constructionPct, possessionWindow, computeMatch, type PossessionWindow } from "./match";
import { loadSalesPolicy, type SalesPolicy } from "./policy";
import { activeHoldsForUnit } from "./holds";
import { needsForProspect } from "./prospects";

// 24-sales-inventory-discovery.md rules 1–3 + 7: the inventory read model over 04 (unit), 07
// (progress), 08 (gates + flexibility), 14 (readiness). Read-only on physics — nothing here
// writes unit_progress or unit_change_gate (08's evaluateUnit persists its own derived rows,
// which is 08's write, not Sales'). No `sales` module exists in the 32-module matrix → STAFF read.
//
// Reconciliations, flagged not faked:
//  - "expected possession window (06 forecast ± confidence)": 06 has no per-unit construction
//    forecast for an unbooked unit — the window is banded around the nearest planned handover
//    date (hierarchy node, else project) with a width by construction % (match.ts). UNCONFIRMED.
//  - "Ready-to-Move = Unit Readiness ≥ threshold and handover gates PASSED except CUSTOMER": an
//    available unit has no booking, so the booking-scoped gates (financial/legal/registration)
//    don't exist yet — built as readiness ≥ handover_policy.readiness_threshold AND QA approved AND
//    utilities ready AND no critical snag (the physical/quality gates that ARE unit-scoped).
//  - Filter names → categories come from sales_policy.filter_categories (the spec's LAYOUT_WALLS/
//    KITCHEN/... names mapped onto the four real seeded categories; bathroom has none yet).

export interface GateChip {
  category_code: string;
  customer_label: string;
  state: GateView["state"];
  display_state: GateView["state"] | "VERIFICATION_REQUIRED";
  reason: string;
  expected_close_at: string | null;
  freshness_status: GateView["freshness_status"];
  source_at: string;
  held_until: string | null;
}

export interface InventoryUnit {
  unit_id: string;
  unit_number: string;
  unit_type: string;
  facing: string;
  product_type: string;
  hierarchy_node_id: string;
  sale_status: string;
  price_inr: number | null;
  carpet_area_sqft: number | null;
  saleable_area_sqft: number | null;
  construction_pct: number;
  expected_possession_window: PossessionWindow | null;
  flexibility: { value: number; drivers: { code: string; label: string; contribution: number; fact: string }[]; confidence: string };
  gates: GateChip[];
  closing_soon: boolean;
  ready_to_move: boolean;
  freshness: "FRESH" | "VERIFICATION_REQUIRED";
  filters: string[];
}

export interface InventoryFilters {
  node_id?: string;
  sale_status?: string;
  facing?: string;
  min_price?: number;
  max_price?: number;
  /** named toggles: highly_customisable, layout_flexible, kitchen_open, electrical_open, flooring_open, ready_to_move, closing_soon */
  named?: string[];
  sort?: "price" | "flexibility" | "possession" | "unit_number";
}

interface UnitRow {
  id: string; unit_number: string; unit_type: string; facing: string; product_type: string; hierarchy_node_id: string; sale_status: string;
  base_price_inr: number | null; carpet_area_sqft: number | null; saleable_area_sqft: number | null; utilities_ready: boolean;
  node_handover: unknown; project_handover: unknown; readiness_threshold: number | null;
}

const UNIT_SELECT = `SELECT u.id, u.unit_number, u.unit_type, u.facing, u.product_type, u.hierarchy_node_id, u.sale_status,
  u.base_price_inr::float8 AS base_price_inr, u.carpet_area_sqft::float8 AS carpet_area_sqft, u.saleable_area_sqft::float8 AS saleable_area_sqft, u.utilities_ready,
  n.planned_handover_date AS node_handover, p.planned_handover_date AS project_handover, hp.readiness_threshold::float8 AS readiness_threshold
  FROM unit u JOIN project_hierarchy_node n ON n.id = u.hierarchy_node_id JOIN project p ON p.id = u.project_id
  LEFT JOIN handover_policy hp ON hp.project_id = u.project_id`;

const asDate = (v: unknown): string | null => (v ? new Date(v as string).toISOString().slice(0, 10) : null);

async function buildUnit(row: UnitRow, policy: SalesPolicy, asOf: string): Promise<InventoryUnit> {
  const progress = await db.query<{ state_code: ProgressState; pct: number | null; weight: number }>(
    `SELECT p.state_code, p.pct, c.readiness_weight AS weight FROM unit_progress p JOIN component_definition c ON c.code = p.component_code WHERE p.unit_id = $1`,
    [row.id]
  );
  const pct = constructionPct(progress.rows.map((p) => ({ state: p.state_code, pct: p.pct, weight: p.weight })));
  const anchor = asDate(row.node_handover) ?? asDate(row.project_handover);
  const window = possessionWindow(anchor, pct, row.node_handover ? "hierarchy node planned handover" : "project planned handover");

  const matrix = await evaluateUnit(row.id, { trigger: "read", asOf });
  const holds = await activeHoldsForUnit(row.id);
  const gates: GateChip[] = matrix.gates.map((g) => ({
    category_code: g.category_code, customer_label: g.customer_label, state: g.state,
    display_state: g.freshness_status === "VERIFICATION_REQUIRED" ? "VERIFICATION_REQUIRED" : g.state,
    reason: g.reason_text, expected_close_at: g.expected_close_at, freshness_status: g.freshness_status, source_at: g.last_evaluated_at,
    held_until: holds.find((h) => h.category_code === g.category_code)?.approved_until ?? null,
  }));

  const readiness = await unitReadiness(row.id);
  const readyToMove = row.readiness_threshold !== null && readiness.value >= row.readiness_threshold && readiness.qa_approved && row.utilities_ready && readiness.critical_snags === 0;
  const closingSoon = matrix.gates.some((g) => g.customer_visible && g.state === "CLOSING" && (!g.expected_close_at || daysBetween(asOf, g.expected_close_at) <= policy.closing_soon_days));
  const stateOf = (cat: string | undefined) => (cat ? matrix.gates.find((g) => g.category_code === cat)?.state : undefined);
  const openish = (s: GateView["state"] | undefined) => s === "OPEN" || s === "CLOSING";

  const filters: string[] = [];
  if (matrix.flexibility.value >= policy.highly_customisable_min) filters.push("highly_customisable");
  for (const [name, cat] of Object.entries(policy.filter_categories)) if (openish(stateOf(cat))) filters.push(name);
  if (readyToMove) filters.push("ready_to_move");
  if (closingSoon) filters.push("closing_soon");

  return {
    unit_id: row.id, unit_number: row.unit_number, unit_type: row.unit_type, facing: row.facing, product_type: row.product_type, hierarchy_node_id: row.hierarchy_node_id,
    sale_status: toSpecUnitSaleStatus(row.sale_status), price_inr: row.base_price_inr, carpet_area_sqft: row.carpet_area_sqft, saleable_area_sqft: row.saleable_area_sqft,
    construction_pct: pct, expected_possession_window: window,
    flexibility: { value: matrix.flexibility.value, drivers: matrix.flexibility.drivers, confidence: matrix.flexibility.confidence },
    gates, closing_soon: closingSoon, ready_to_move: readyToMove,
    freshness: gates.some((g) => g.freshness_status === "VERIFICATION_REQUIRED") ? "VERIFICATION_REQUIRED" : "FRESH",
    filters,
  };
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / (24 * 60 * 60 * 1000);
}

export async function listInventory(projectId: string, filters: InventoryFilters, ctx: Ctx, asOf?: string): Promise<InventoryUnit[]> {
  requireRole(ctx, STAFF_ROLES);
  const policy = await loadSalesPolicy(projectId);
  const today = asOf ?? new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scoped = filters.node_id ? (await unitsInScope(projectId, { node_ids: [filters.node_id] }, db)).map((u) => u.id) : null;
  const conds = ["u.project_id = $1"];
  const params: unknown[] = [projectId];
  if (scoped) { params.push(scoped); conds.push(`u.id = ANY($${params.length}::text[])`); }
  if (filters.sale_status) { params.push(filters.sale_status.toLowerCase()); conds.push(`u.sale_status = $${params.length}`); }
  if (filters.facing) { params.push(filters.facing); conds.push(`u.facing = $${params.length}`); }
  if (filters.min_price !== undefined) { params.push(filters.min_price); conds.push(`u.base_price_inr >= $${params.length}`); }
  if (filters.max_price !== undefined) { params.push(filters.max_price); conds.push(`u.base_price_inr <= $${params.length}`); }
  const rows = await db.query<UnitRow>(`${UNIT_SELECT} WHERE ${conds.join(" AND ")} ORDER BY u.unit_number`, params);

  const out: InventoryUnit[] = [];
  for (const row of rows.rows) {
    const u = await buildUnit(row, policy, today);
    if ((filters.named ?? []).every((n) => u.filters.includes(n))) out.push(u);
  }
  const sort = filters.sort ?? "unit_number";
  out.sort((a, b) =>
    sort === "price" ? (a.price_inr ?? Infinity) - (b.price_inr ?? Infinity)
      : sort === "flexibility" ? b.flexibility.value - a.flexibility.value
      : sort === "possession" ? (a.expected_possession_window?.anchor ?? "9999").localeCompare(b.expected_possession_window?.anchor ?? "9999")
      : a.unit_number.localeCompare(b.unit_number)
  );
  return out;
}

/** Rule 3: ≥ 3 units side by side (max 4 — the compare tray), with the requirement match when a prospect is chosen. */
export async function compareUnits(unitIds: string[], prospectId: string | undefined, ctx: Ctx): Promise<{ units: (InventoryUnit & { match: ReturnType<typeof computeMatch> | null })[]; disclaimer: string | null }> {
  requireRole(ctx, STAFF_ROLES);
  const ids = [...new Set(unitIds ?? [])];
  if (ids.length < 3 || ids.length > 4) throw new AppError("validation", "compare needs 3 or 4 distinct units", "unit_ids");
  const rows = await db.query<UnitRow>(`${UNIT_SELECT} WHERE u.id = ANY($1::text[])`, [ids]);
  if (rows.rows.length !== ids.length) throw new AppError("not_found", "one or more units not found");
  const projectIds = new Set((await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = ANY($1::text[])`, [ids])).rows.map((r) => r.project_id));
  if (projectIds.size !== 1) throw new AppError("validation", "compare units from one project", "unit_ids");
  const projectId = [...projectIds][0]!;
  const policy = await loadSalesPolicy(projectId);
  const needs = prospectId ? await needsForProspect(prospectId) : null;
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const units = [];
  for (const id of ids) {
    const u = await buildUnit(rows.rows.find((r) => r.id === id)!, policy, today);
    const match = needs
      ? computeMatch(needs, u.gates.map((g) => ({ category_code: g.category_code, customer_label: g.customer_label, state: g.state, reason_text: g.reason, expected_close_at: g.expected_close_at, freshness_status: g.freshness_status })), policy)
      : null;
    units.push({ ...u, match });
  }
  return { units, disclaimer: needs ? units[0]?.match?.disclaimer ?? null : null };
}
