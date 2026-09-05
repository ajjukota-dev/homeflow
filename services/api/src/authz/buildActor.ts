import { query } from "../db";
import { resolveProjectIds } from "./scope";
import type { Actor } from "./types";

interface UserRow {
  id: string;
  display_name: string;
  kind: "STAFF" | "CUSTOMER";
  default_project_id: string | null;
}

/** Assembles ctx.actor (00-conventions.md) for a validated session's user_id. */
export async function buildActor(userId: string): Promise<Actor | null> {
  const users = await query<UserRow>(
    `SELECT id, display_name, kind, default_project_id FROM "user" WHERE id = $1 AND status = 'ACTIVE'`,
    [userId]
  );
  const user = users.rows[0];
  if (!user) return null;

  const roleRows = await query<{ role_code: string }>(`SELECT role_code FROM user_role WHERE user_id = $1`, [userId]);
  const roles = roleRows.rows.map((r) => r.role_code);
  const projectIds = await resolveProjectIds(userId, roles, user.kind);

  let defaultProjectId = user.default_project_id;
  if (!defaultProjectId && projectIds !== "ALL" && projectIds.length > 0) {
    defaultProjectId = projectIds[0];
  }

  return {
    user_id: user.id,
    display_name: user.display_name,
    kind: user.kind,
    roles,
    project_ids: projectIds,
    default_project_id: defaultProjectId,
  };
}
