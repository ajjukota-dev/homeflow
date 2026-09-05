import { query } from "../db";
import { todayIst } from "./clock";
import { levelAtLeast, maxLevel, type Level } from "./levels";
import { AppError, type Ctx } from "./types";

/** Rule 5: highest permission_matrix level across the actor's roles, effective today. */
export async function effectiveLevel(roles: string[], module: string): Promise<Level> {
  if (roles.length === 0) return "NONE";
  const today = todayIst();
  const placeholders = roles.map((_, i) => `$${i + 2}`).join(",");
  const r = await query<{ level: Level }>(
    `SELECT level FROM permission_matrix
      WHERE module = $1 AND role_code IN (${placeholders})
        AND effective_from <= $${roles.length + 2}
        AND (effective_to IS NULL OR effective_to >= $${roles.length + 2})`,
    [module, ...roles, today]
  );
  return maxLevel(r.rows.map((row) => row.level));
}

/** Rule 5: `authorize(ctx, module, level)` — NONE (or below `level`) → forbidden. */
export async function authorize(ctx: Ctx, module: string, level: Level): Promise<Level> {
  const have = await effectiveLevel(ctx.actor.roles, module);
  if (!levelAtLeast(have, level)) {
    throw new AppError("forbidden", `${module} requires ${level}, actor has ${have}`);
  }
  return have;
}
