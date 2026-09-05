import { db } from "../db";
import type { DbLike } from "../events";
import { ValidationError } from "./derive";
import { requireRole, SITE_SETUP_ROLES, STAFF_ROLES } from "../authz/requireRole";
import type { Ctx } from "../authz/types";

// Project master fields (04 §Data) — extends the existing services/api/src/projects.ts
// (list/create/unit-creation) which predates this spec. Kept separate to respect the
// 200-line rule and because 04's Files list is services/api/src/model/**.

export type ProductType = "APARTMENT" | "VILLA" | "PLOT" | "MIXED";
export type ProjectStatus = "PLANNING" | "ACTIVE" | "HANDOVER" | "CLOSED";

export interface ProjectMaster {
  id: string;
  code: string;
  name: string;
  portfolio_id: string | null;
  product_type: ProductType;
  legal_entity: string | null;
  jurisdiction: string | null;
  rera_reg_no: string | null;
  escrow_account_ref: string | null;
  location: string | null;
  launch_date: string | null;
  planned_handover_date: string | null;
  status: ProjectStatus;
}

const PATCHABLE = [
  "name",
  "product_type",
  "legal_entity",
  "jurisdiction",
  "rera_reg_no",
  "escrow_account_ref",
  "location",
  "launch_date",
  "planned_handover_date",
  "status",
] as const;
type Patchable = (typeof PATCHABLE)[number];

/** The single seeded portfolio row (p21 §14) — projects never ask a user to pick one. */
export async function defaultPortfolioId(handle: DbLike = db): Promise<string> {
  const r = await handle.query<{ id: string }>(`SELECT id FROM portfolio ORDER BY id LIMIT 1`);
  if (r.rows.length === 0) throw new ValidationError("no portfolio seeded");
  return r.rows[0].id;
}

// `ctx` optional: also called internally by updateProject (existing check + return-fresh-state).
export async function getProjectMaster(id: string, ctx?: Ctx): Promise<ProjectMaster | null> {
  if (ctx) requireRole(ctx, STAFF_ROLES);
  const r = await db.query<ProjectMaster>(
    `SELECT id, code, name, portfolio_id, product_type, legal_entity, jurisdiction, rera_reg_no,
            escrow_account_ref, location,
            launch_date::text AS launch_date, planned_handover_date::text AS planned_handover_date,
            status
       FROM project WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function updateProject(
  id: string,
  patch: Partial<Record<Patchable, string>>,
  ctx: Ctx
): Promise<ProjectMaster> {
  requireRole(ctx, SITE_SETUP_ROLES);
  const existing = await getProjectMaster(id);
  if (!existing) throw new ValidationError("project_not_found");
  const fields = Object.keys(patch).filter((k): k is Patchable => (PATCHABLE as readonly string[]).includes(k));
  if (fields.length === 0) return existing;
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  await db.query(`UPDATE project SET ${sets} WHERE id = $1`, [id, ...fields.map((f) => patch[f])]);
  return (await getProjectMaster(id))!;
}
