import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";

// 15-qa-evidence-snags.md `external_dependency` + rule 4. A dependency sits on a hierarchy node
// and blocks every unit under it (ancestor walk, same recursive CTE shape as progress/core.ts).
// Consumers today: handover.ts's FM/Community soft gate via qa.ts::handoverForBooking. 14's
// unit-readiness score does not yet read these — flagged in TODO.md, not faked.

const KINDS = ["COMMON_AREA", "UTILITY_POWER", "UTILITY_WATER", "LIFT", "STP", "FIRE_NOC", "OCCUPANCY_CERT", "OTHER"];
const STATUSES = ["PENDING", "IN_PROGRESS", "DONE"];

export interface DependencyRow {
  id: string;
  project_id: string;
  hierarchy_node_id: string;
  kind: string;
  label: string;
  status: string;
  expected_date: string | null;
  owner_user_id: string | null;
}

const SELECT = `SELECT id, project_id, hierarchy_node_id, kind, label, status, expected_date::text AS expected_date, owner_user_id FROM external_dependency`;

export async function listDependencies(projectId: string, ctx: Ctx): Promise<DependencyRow[]> {
  await authorize(ctx, "unit_readiness", "READ");
  const r = await db.query<DependencyRow>(`${SELECT} WHERE project_id = $1 ORDER BY status, expected_date NULLS LAST, label`, [projectId]);
  return r.rows;
}

export async function createDependency(
  projectId: string,
  input: { hierarchy_node_id: string; kind: string; label: string; expected_date?: string | null; owner_user_id?: string | null },
  ctx: Ctx
): Promise<DependencyRow> {
  await authorize(ctx, "unit_readiness", "WRITE");
  if (!KINDS.includes(input.kind)) throw new AppError("validation", `invalid kind ${input.kind}`, "kind");
  if (!input.label?.trim()) throw new AppError("validation", "label is required", "label");
  const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE id = $1 AND project_id = $2`, [input.hierarchy_node_id, projectId]);
  if (!node.rows[0]) throw new AppError("validation", "hierarchy_node_id is not a node of this project", "hierarchy_node_id");
  const id = "dep_" + randomUUID().slice(0, 8);
  await db.query(
    `INSERT INTO external_dependency (id, project_id, hierarchy_node_id, kind, label, expected_date, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, projectId, input.hierarchy_node_id, input.kind, input.label.trim(), input.expected_date ?? null, input.owner_user_id ?? null]
  );
  return (await db.query<DependencyRow>(`${SELECT} WHERE id = $1`, [id])).rows[0]!;
}

export async function patchDependency(
  id: string,
  input: { status?: string; expected_date?: string | null; owner_user_id?: string | null; label?: string },
  ctx: Ctx
): Promise<DependencyRow> {
  await authorize(ctx, "unit_readiness", "WRITE");
  if (input.status !== undefined && !STATUSES.includes(input.status)) throw new AppError("validation", `invalid status ${input.status}`, "status");
  const before = (await db.query<DependencyRow>(`${SELECT} WHERE id = $1`, [id])).rows[0];
  if (!before) throw new AppError("not_found", "dependency not found");
  await withTx(undefined, async (tx) => {
    await tx.query(
      `UPDATE external_dependency
          SET status = COALESCE($2, status), expected_date = COALESCE($3, expected_date),
              owner_user_id = COALESCE($4, owner_user_id), label = COALESCE($5, label), updated_at = now()
        WHERE id = $1`,
      [id, input.status ?? null, input.expected_date ?? null, input.owner_user_id ?? null, input.label ?? null]
    );
    if (input.status && input.status !== before.status) {
      await appendEvent(tx, {
        type: "dependency.status_changed", entity_type: "external_dependency", entity_id: id, project_id: before.project_id,
        payload: { kind: before.kind, label: before.label, from: before.status, to: input.status }, ...actorFields(ctx),
      });
    }
  });
  return (await db.query<DependencyRow>(`${SELECT} WHERE id = $1`, [id])).rows[0]!;
}

/** Rule 4's blocker text for one unit: every PENDING/IN_PROGRESS dependency on the unit's node or
 *  any ancestor. Pure read, no ctx — called from the gate evaluation path. */
export async function dependencyBlockersForUnit(unitId: string, tx: DbLike = db): Promise<string[]> {
  const r = await tx.query<{ label: string; expected_date: string | null }>(
    `WITH RECURSIVE anc AS (
       SELECT n.id, n.parent_id FROM project_hierarchy_node n JOIN unit u ON u.hierarchy_node_id = n.id WHERE u.id = $1
       UNION ALL
       SELECT p.id, p.parent_id FROM project_hierarchy_node p JOIN anc ON anc.parent_id = p.id
     )
     SELECT d.label, d.expected_date::text AS expected_date
       FROM external_dependency d JOIN anc ON anc.id = d.hierarchy_node_id
      WHERE d.status IN ('PENDING', 'IN_PROGRESS')
      ORDER BY d.expected_date NULLS LAST, d.label`,
    [unitId]
  );
  return r.rows.map((d) => `Common area: ${d.label} expected ${d.expected_date ?? "date TBC"}`);
}
