// 28-360-views.md rule 1 — Unit 360's Overview tab, plus a manifest for the rest (content of
// those tabs is owned by their own specs — 07/08/09/18/15/16/22/30/02).

import { db } from "../db";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { computeUnitReadiness } from "../scores/unit-readiness";
import { getUnitChangeability } from "../changeability/core";
import { tab, notYetAvailable, type TabManifestEntry } from "./tabs";

interface HierarchyNode { id: string; parent_id: string | null; kind: string; name: string }

export interface ActivityRow { type: string; occurred_at: string; payload: unknown }

/** GET /units/:id/activity — 02's event log, filtered to this unit (a real per-entity query;
 *  `event.unit_id` is a direct column, no join needed). */
export async function getUnitActivity(unitId: string, ctx: Ctx): Promise<ActivityRow[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<ActivityRow>(
    `SELECT type, occurred_at::text AS occurred_at, payload FROM event WHERE unit_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
    [unitId]
  );
  return r.rows;
}

async function hierarchyPath(projectId: string, nodeId: string): Promise<{ kind: string; name: string }[]> {
  const nodes = await db.query<HierarchyNode>(`SELECT id, parent_id, kind, name FROM project_hierarchy_node WHERE project_id = $1`, [projectId]);
  const byId = new Map(nodes.rows.map((n) => [n.id, n]));
  const path: { kind: string; name: string }[] = [];
  let cursor: HierarchyNode | undefined = byId.get(nodeId);
  while (cursor) {
    path.unshift({ kind: cursor.kind, name: cursor.name });
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return path;
}

export interface Unit360View {
  unit_id: string;
  project_id: string;
  unit_number: string;
  unit_type: string;
  product_type: string;
  facing: string;
  sale_status: string;
  hierarchy_path: { kind: string; name: string }[];
  areas: { carpet_sqft: number | null; built_up_sqft: number | null; saleable_sqft: number | null; plot_sqyd: number | null };
  base_price_inr: number | null;
  current_booking: { id: string; booking_number: string; status: string } | null;
  readiness: Awaited<ReturnType<typeof computeUnitReadiness>>;
  flexibility: Awaited<ReturnType<typeof getUnitChangeability>>["flexibility"];
  tabs: TabManifestEntry[];
}

export async function getUnit360(unitId: string, ctx: Ctx): Promise<Unit360View> {
  requireRole(ctx, STAFF_ROLES);
  const u = await db.query<{
    project_id: string; unit_number: string; unit_type: string; product_type: string; facing: string;
    sale_status: string; hierarchy_node_id: string; carpet_area_sqft: number | null; built_up_area_sqft: number | null;
    saleable_area_sqft: number | null; plot_area_sqyd: number | null; base_price_inr: number | null;
  }>(
    `SELECT project_id, unit_number, unit_type, product_type, facing, sale_status, hierarchy_node_id,
            carpet_area_sqft::float8 AS carpet_area_sqft, built_up_area_sqft::float8 AS built_up_area_sqft,
            saleable_area_sqft::float8 AS saleable_area_sqft, plot_area_sqyd::float8 AS plot_area_sqyd,
            base_price_inr::float8 AS base_price_inr
       FROM unit WHERE id = $1`,
    [unitId]
  );
  if (!u.rows[0]) throw new AppError("not_found", "not_found");
  const row = u.rows[0];

  const booking = await db.query<{ id: string; booking_number: string; status: string }>(
    `SELECT id, booking_number, status FROM booking WHERE unit_id = $1 ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`,
    [unitId]
  );
  const [hierarchy_path, readiness, changeability] = await Promise.all([
    hierarchyPath(row.project_id, row.hierarchy_node_id),
    computeUnitReadiness(unitId),
    getUnitChangeability(unitId, ctx),
  ]);

  return {
    unit_id: unitId,
    project_id: row.project_id,
    unit_number: row.unit_number,
    unit_type: row.unit_type,
    product_type: row.product_type,
    facing: row.facing,
    sale_status: row.sale_status,
    hierarchy_path,
    areas: {
      carpet_sqft: row.carpet_area_sqft,
      built_up_sqft: row.built_up_area_sqft,
      saleable_sqft: row.saleable_area_sqft,
      plot_sqyd: row.plot_area_sqyd,
    },
    base_price_inr: row.base_price_inr,
    current_booking: booking.rows[0] ?? null,
    readiness,
    flexibility: changeability.flexibility,
    tabs: [
      tab("progress", "Progress", `/api/units/${unitId}/progress`),
      tab("changeability", "Changeability", `/api/units/${unitId}/changeability`),
      tab("specification", "Specification", `/api/units/${unitId}/specification`),
      booking.rows[0]
        ? tab("customisations", "Customisations", `/api/change-requests?booking_id=${booking.rows[0].id}`)
        : notYetAvailable("customisations", "Customisations", "18 (no booking on this unit yet — nothing to show)"),
      tab("qa_snags", "QA & Snags", `/api/units/${unitId}/inspections`),
      tab("handover", "Handover", booking.rows[0] ? `/api/bookings/${booking.rows[0].id}/handover` : `/api/units/${unitId}`),
      booking.rows[0]
        ? tab("documents", "Documents", `/api/bookings/${booking.rows[0].id}/customer-documents`)
        : notYetAvailable("documents", "Documents", "22 (no booking on this unit yet — nothing to show)"),
      tab("post_handover", "Post-handover", `/api/units/${unitId}/service-history`),
      tab("activity", "Activity", `/api/units/${unitId}/activity`),
    ],
  };
}
