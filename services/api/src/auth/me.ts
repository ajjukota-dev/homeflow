import { query } from "../db";
import type { Ctx } from "../authz/types";

export interface MeResponse {
  user: { id: string; email: string; display_name: string; kind: "STAFF" | "CUSTOMER" };
  roles: string[];
  project_ids: string[] | "ALL";
  default_project_id: string | null;
}

/** GET /auth/me (01-identity-access.md API). */
export async function me(ctx: Ctx): Promise<MeResponse> {
  const rows = await query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [ctx.actor.user_id]);
  return {
    user: {
      id: ctx.actor.user_id,
      email: rows.rows[0]?.email ?? "",
      display_name: ctx.actor.display_name,
      kind: ctx.actor.kind,
    },
    roles: ctx.actor.roles,
    project_ids: ctx.actor.project_ids,
    default_project_id: ctx.actor.default_project_id,
  };
}
