import { randomUUID } from "node:crypto";
import { query } from "../db";
import { authorize } from "../authz/authorize";
import { AppError, type Ctx } from "../authz/types";
import { issueInvite } from "./invite";

export interface UserListItem {
  id: string;
  email: string;
  display_name: string;
  status: string;
  kind: string;
  roles: string[];
}

/** Rule 2: SUPER_ADMIN/MANAGEMENT manage staff. GET /admin/users. */
export async function listUsers(ctx: Ctx): Promise<UserListItem[]> {
  await authorize(ctx, "administration", "WRITE");
  const users = await query<{ id: string; email: string; display_name: string; status: string; kind: string }>(
    `SELECT id, email, display_name, status, kind FROM "user" ORDER BY display_name`
  );
  const roles = await query<{ user_id: string; role_code: string }>(`SELECT user_id, role_code FROM user_role`);
  const rolesByUser = new Map<string, string[]>();
  for (const r of roles.rows) rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) ?? []), r.role_code]);
  return users.rows.map((u) => ({ ...u, roles: rolesByUser.get(u.id) ?? [] }));
}

export interface CreateUserInput {
  email: string;
  display_name: string;
  roles: string[];
  kind?: "STAFF" | "CUSTOMER";
}

/** POST /admin/users — invite-only account creation (Rule 2: no self-signup). */
export async function createUser(input: CreateUserInput, ctx: Ctx): Promise<{ id: string }> {
  await authorize(ctx, "administration", "WRITE");
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email || !input.display_name || !input.roles?.length) {
    throw new AppError("validation", "email, display_name and at least one role are required");
  }
  const existing = await query(`SELECT id FROM "user" WHERE lower(email) = $1`, [email]);
  if (existing.rows.length > 0) throw new AppError("conflict", "a user with this email already exists", "email");

  const userId = randomUUID();
  await query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ($1,$2,$3,'INVITED',$4)`, [
    userId,
    email,
    input.display_name,
    input.kind ?? "STAFF",
  ]);
  for (const role of input.roles) {
    await query(`INSERT INTO user_role (user_id, role_code) VALUES ($1,$2)`, [userId, role]);
  }
  await issueInvite(userId, ctx.actor.user_id, email);
  return { id: userId };
}

export interface UpdateUserInput {
  display_name?: string;
  roles?: string[];
  status?: "ACTIVE" | "DISABLED";
}

/** PATCH /admin/users/:id */
export async function updateUser(id: string, input: UpdateUserInput, ctx: Ctx): Promise<void> {
  await authorize(ctx, "administration", "WRITE");
  if (input.display_name) await query(`UPDATE "user" SET display_name = $1 WHERE id = $2`, [input.display_name, id]);
  if (input.status) await query(`UPDATE "user" SET status = $1 WHERE id = $2`, [input.status, id]);
  if (input.roles) {
    await query(`DELETE FROM user_role WHERE user_id = $1`, [id]);
    for (const role of input.roles) await query(`INSERT INTO user_role (user_id, role_code) VALUES ($1,$2)`, [id, role]);
  }
}
