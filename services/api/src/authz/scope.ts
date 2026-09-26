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
    ? new AppError("not_found", "not_found")
    : new AppError("forbidden", "outside your assigned projects");
}

/** Drop list rows the actor cannot read. A null project id is org-wide and stays.
 *  Management and Super Admin (`project_ids` ALL) keep every row. Each project id is
 *  checked with assertProjectScope, the same read rule as a guessed id. */
export function rowsInProjectScope<T>(
  actor: Actor,
  rows: T[],
  projectIdOf: (row: T) => string | null | undefined
): T[] {
  if (actor.project_ids === "ALL") return rows;
  return rows.filter((row) => {
    const projectId = projectIdOf(row);
    if (!projectId) return true;
    try {
      assertProjectScope(actor, projectId, "read");
      return true;
    } catch (err) {
      if (err instanceof AppError && err.code === "not_found") return false;
      throw err;
    }
  });
}

/** SQL twin of rowsInProjectScope for a query that pages before the rows are in memory.
 *  Null project_id stays. ALL adds no predicate. */
export function projectScopeSql(actor: Actor, column: string, params: unknown[]): string | null {
  if (actor.project_ids === "ALL") return null;
  params.push(actor.project_ids);
  return `(${column} IS NULL OR ${column} = ANY($${params.length}::text[]))`;
}
