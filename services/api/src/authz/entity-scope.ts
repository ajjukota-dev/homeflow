import { query } from "../db";
import { runAsSystem } from "../db/rls-context";
import { AppError, type Ctx } from "./types";
import { assertProjectScope } from "./scope";

// Load project_id from the resource (never a client-supplied project_id), then
// assertProjectScope. System lookup so a write to another project is 403, not a
// silent RLS 404. Defense in depth on top of 0025/0047 policies.

export type ScopeEntity =
  | "booking"
  | "unit"
  | "demand"
  | "customer"
  | "project"
  | "action"
  | "change_request"
  | "qa_inspection"
  | "snag"
  | "hold";

const SQL: Record<ScopeEntity, string> = {
  booking: `SELECT project_id FROM booking WHERE id = $1`,
  unit: `SELECT project_id FROM unit WHERE id = $1`,
  demand: `SELECT project_id FROM demand WHERE id = $1`,
  project: `SELECT id AS project_id FROM project WHERE id = $1`,
  customer: `SELECT b.project_id
               FROM booking_applicant a
               JOIN booking b ON b.id = a.booking_id
              WHERE a.customer_id = $1
              ORDER BY (b.status = 'active') DESC, b.created_at DESC
              LIMIT 1`,
  action: `SELECT project_id FROM action WHERE id = $1`,
  change_request: `SELECT project_id FROM change_request WHERE id = $1`,
  qa_inspection: `SELECT project_id FROM qa_inspection WHERE id = $1`,
  snag: `SELECT project_id FROM snag WHERE id = $1`,
  hold: `SELECT project_id FROM change_window_hold WHERE id = $1`,
};

/** Returns the resource's project_id after asserting the actor may read/write it. */
export async function assertEntityScope(
  ctx: Ctx,
  entity: ScopeEntity,
  id: string,
  mode: "read" | "write"
): Promise<string> {
  const projectId = await runAsSystem(async () => {
    const r = await query<{ project_id: string }>(SQL[entity], [id]);
    return r.rows[0]?.project_id ?? null;
  });
  if (!projectId) throw new AppError("not_found", "not_found");
  assertProjectScope(ctx.actor, projectId, mode);
  return projectId;
}

/** Actions may be unscoped (null project_id) in tests; fall back to booking. */
export async function assertActionScope(ctx: Ctx, actionId: string, mode: "read" | "write"): Promise<string> {
  const row = await runAsSystem(async () => {
    const r = await query<{ project_id: string | null; booking_id: string | null }>(
      `SELECT project_id, booking_id FROM action WHERE id = $1`,
      [actionId]
    );
    return r.rows[0] ?? null;
  });
  if (!row) throw new AppError("not_found", "not_found");
  if (row.project_id) {
    assertProjectScope(ctx.actor, row.project_id, mode);
    return row.project_id;
  }
  if (row.booking_id) return assertEntityScope(ctx, "booking", row.booking_id, mode);
  return "";
}
