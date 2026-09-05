import { randomUUID } from "node:crypto";
import { query } from "../db";
import { authorize } from "../authz/authorize";
import { todayIst } from "../authz/clock";
import type { Level } from "../authz/levels";
import { AppError, type Ctx } from "../authz/types";
import { appendAuthEvent } from "./events";

export interface PermissionMatrixRow {
  role_code: string;
  module: string;
  level: Level;
  effective_from: string;
  effective_to: string | null;
  version: number;
}

/** GET /admin/permission-matrix — the full role × module grid (current + history). */
export async function getPermissionMatrix(ctx: Ctx): Promise<PermissionMatrixRow[]> {
  await authorize(ctx, "administration", "WRITE");
  const r = await query<PermissionMatrixRow>(
    `SELECT role_code, module, level, effective_from, effective_to, version FROM permission_matrix
      ORDER BY role_code, module, effective_from DESC`
  );
  return r.rows;
}

export interface PutPermissionMatrixInput {
  changes: { role_code: string; module: string; level: Level }[];
}

/** PUT /admin/permission-matrix — Rule 8-style: closes the prior row, opens a new version. */
export async function putPermissionMatrix(input: PutPermissionMatrixInput, ctx: Ctx): Promise<void> {
  await authorize(ctx, "administration", "ADMIN"); // only SUPER_ADMIN is seeded at ADMIN
  if (!input.changes?.length) throw new AppError("validation", "changes[] is required");

  const today = todayIst();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const change of input.changes) {
    const current = await query<{ version: number }>(
      `SELECT version FROM permission_matrix WHERE role_code = $1 AND module = $2
         AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3)`,
      [change.role_code, change.module, today]
    );
    const nextVersion = (current.rows[0]?.version ?? 0) + 1;
    await query(
      `UPDATE permission_matrix SET effective_to = $1
         WHERE role_code = $2 AND module = $3 AND (effective_to IS NULL OR effective_to >= $4)`,
      [yesterday, change.role_code, change.module, today]
    );
    await query(
      `INSERT INTO permission_matrix (id, role_code, module, level, effective_from, version) VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), change.role_code, change.module, change.level, today, nextVersion]
    );
  }
  await appendAuthEvent("access.permission_matrix_changed", ctx.actor.user_id, null, { changes: input.changes });
}
