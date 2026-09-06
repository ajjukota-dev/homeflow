// 28-360-views.md rule 4 — "context (project + last entity) retained across navigation and
// sessions." No consequential domain change (a per-user UI preference, not a business event) —
// no `appendEvent` call, same reasoning as other purely-cosmetic per-user settings in this codebase.

import { db } from "../db";
import type { Ctx } from "../authz/types";

export interface RecentContext {
  last_project_id: string | null;
  last_entity_type: "unit" | "customer" | "booking" | null;
  last_entity_id: string | null;
}

export async function getMyContext(ctx: Ctx): Promise<RecentContext> {
  const r = await db.query<RecentContext>(
    `SELECT last_project_id, last_entity_type, last_entity_id FROM user_preference WHERE user_id = $1`,
    [ctx.actor.user_id]
  );
  return r.rows[0] ?? { last_project_id: null, last_entity_type: null, last_entity_id: null };
}

export async function setMyContext(
  ctx: Ctx,
  input: { project_id?: string | null; entity_type?: "unit" | "customer" | "booking" | null; entity_id?: string | null }
): Promise<RecentContext> {
  const r = await db.query<RecentContext>(
    `INSERT INTO user_preference (user_id, last_project_id, last_entity_type, last_entity_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       last_project_id = COALESCE($2, user_preference.last_project_id),
       last_entity_type = COALESCE($3, user_preference.last_entity_type),
       last_entity_id = COALESCE($4, user_preference.last_entity_id),
       updated_at = now()
     RETURNING last_project_id, last_entity_type, last_entity_id`,
    [ctx.actor.user_id, input.project_id ?? null, input.entity_type ?? null, input.entity_id ?? null]
  );
  return r.rows[0]!;
}
