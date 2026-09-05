import { query } from "../db";
import { AppError, type Actor } from "../authz/types";
import { buildActor } from "../authz/buildActor";
import { verifyPassword } from "./password";
import { createSession, type SessionMeta } from "./session";
import { isRateLimited, recordFailure, clearFailures } from "./rateLimit";
import { appendAuthEvent } from "./events";

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  actor: Actor;
}

/** Rule 1: email+password → argon2id verify → new session. 5 failures/15min/email → rate_limited. */
export async function login(input: LoginInput, meta: SessionMeta = {}): Promise<LoginResult> {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email || !input.password) throw new AppError("validation", "email and password are required");

  if (isRateLimited(email)) {
    throw new AppError("rate_limited", "too many failed attempts — try again in 15 minutes");
  }

  const rows = await query<{ id: string; password_hash: string | null; status: string }>(
    `SELECT id, password_hash, status FROM "user" WHERE lower(email) = $1`,
    [email]
  );
  const user = rows.rows[0];

  const ok = user?.password_hash ? await verifyPassword(user.password_hash, input.password) : false;
  if (!user || !ok || user.status !== "ACTIVE") {
    recordFailure(email);
    await appendAuthEvent("auth.login_failed", null, user?.id ?? null, { email });
    throw new AppError("validation", "invalid email or password", "password");
  }

  clearFailures(email);
  const actor = await buildActor(user.id);
  if (!actor) throw new AppError("validation", "invalid email or password", "password");

  const session = await createSession(user.id, meta);
  await query(`UPDATE "user" SET last_login_at = now() WHERE id = $1`, [user.id]);
  await appendAuthEvent("auth.login_succeeded", user.id, user.id, { email });

  return { token: session.token, expiresAt: session.expiresAt, actor };
}
