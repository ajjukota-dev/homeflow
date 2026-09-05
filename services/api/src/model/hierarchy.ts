import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { DbLike } from "../events";
import { ValidationError } from "./derive";
import { requireRole, SITE_SETUP_ROLES, STAFF_ROLES } from "../authz/requireRole";
import type { Ctx } from "../authz/types";

// project_hierarchy_node — Phase/Tower/Block/Cluster/Floor/Street (04 §Data, p36 §31.1).

export type HierarchyKind = "PHASE" | "TOWER" | "BLOCK" | "CLUSTER" | "FLOOR" | "STREET";

export interface HierarchyNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: HierarchyKind;
  code: string;
  name: string;
  sort_order: number;
  planned_handover_date: string | null;
}

export interface HierarchyNodeInput {
  parent_id?: string | null;
  kind: HierarchyKind;
  code: string;
  name: string;
  sort_order?: number;
  planned_handover_date?: string | null;
}

export async function createHierarchyNode(
  projectId: string,
  input: HierarchyNodeInput,
  ctx: Ctx,
  tx: DbLike = db
): Promise<HierarchyNode> {
  requireRole(ctx, SITE_SETUP_ROLES);
  if (!input.code?.trim() || !input.name?.trim()) throw new ValidationError("code and name required");
  if (input.parent_id) {
    const parent = await tx.query<{ project_id: string }>(
      `SELECT project_id FROM project_hierarchy_node WHERE id = $1`,
      [input.parent_id]
    );
    if (parent.rows.length === 0) throw new ValidationError("parent_not_found", "parent_id");
    if (parent.rows[0].project_id !== projectId) {
      throw new ValidationError("parent must belong to the same project", "parent_id");
    }
  }
  const id = "node_" + randomUUID().slice(0, 8);
  await tx.query(
    `INSERT INTO project_hierarchy_node (id, project_id, parent_id, kind, code, name, sort_order, planned_handover_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      projectId,
      input.parent_id ?? null,
      input.kind,
      input.code.trim(),
      input.name.trim(),
      input.sort_order ?? 0,
      input.planned_handover_date ?? null,
    ]
  );
  return {
    id,
    project_id: projectId,
    parent_id: input.parent_id ?? null,
    kind: input.kind,
    code: input.code.trim(),
    name: input.name.trim(),
    sort_order: input.sort_order ?? 0,
    planned_handover_date: input.planned_handover_date ?? null,
  };
}

/** Flat list, ordered so a caller can render a tree by walking parent_id (sort_order within siblings). */
export async function listHierarchy(projectId: string, ctx: Ctx): Promise<HierarchyNode[]> {
  requireRole(ctx, STAFF_ROLES);
  const r = await db.query<HierarchyNode>(
    `SELECT id, project_id, parent_id, kind, code, name, sort_order,
            planned_handover_date::text AS planned_handover_date
       FROM project_hierarchy_node WHERE project_id = $1
      ORDER BY parent_id NULLS FIRST, sort_order, name`,
    [projectId]
  );
  return r.rows;
}
