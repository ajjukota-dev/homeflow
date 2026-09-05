import { query } from "../db";
import { todayIst } from "./clock";
import { AppError, type Actor } from "./types";

const ALL_PROJECTS_ROLES = new Set(["MANAGEMENT", "SUPER_ADMIN"]);

// Rule 4: MANAGEMENT/SUPER_ADMIN see all projects [E §1.6]; everyone else gets the
// distinct, effective-dated project_team_assignment rows; customers get their
// bookings' projects via customer_login.
export async function resolveProjectIds(
  userId: string,
  roles: string[],
  kind: "STAFF" | "CUSTOMER"
): Promise<string[] | "ALL"> {
  if (roles.some((r) => ALL_PROJECTS_ROLES.has(r))) return "ALL";
  const today = todayIst();

  if (kind === "CUSTOMER") {
    const r = await query<{ project_id: string }>(
      `SELECT DISTINCT b.project_id
         FROM customer_login cl
         JOIN booking b ON b.id = cl.booking_id
        WHERE cl.user_id = $1`,
      [userId]
    );
    return r.rows.map((row) => row.project_id);
  }

  const r = await query<{ project_id: string }>(
    `SELECT DISTINCT project_id FROM project_team_assignment
      WHERE user_id = $1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2)`,
    [userId, today]
  );
  return r.rows.map((row) => row.project_id);
}

/** Rule 5: a row outside scope → not_found on read, forbidden on write [E]. */
export function assertProjectScope(actor: Actor, projectId: string, mode: "read" | "write"): void {
  if (actor.project_ids === "ALL") return;
  if (actor.project_ids.includes(projectId)) return;
  throw mode === "read"
    ? new AppError("not_found", "not found")
    : new AppError("forbidden", "outside your assigned projects");
}
