import { randomBytes, randomUUID, createHash } from "node:crypto";
import { query } from "../db";
import { AppError } from "../authz/types";
import { hashPassword } from "./password";
import { revokeAllSessionsForUser } from "./session";
import { mailer } from "./mailer";
import { appendAuthEvent } from "./events";

const RESET_TTL_MS = 60 * 60 * 1000; // Rule 3: 1h

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Rule 3: email → single-use 1h token. Always succeeds (no user enumeration). */
export async function requestPasswordReset(input: { email: string }): Promise<void> {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) throw new AppError("validation", "email is required");

  const rows = await query<{ id: string; status: string }>(`SELECT id, status FROM "user" WHERE lower(email) = $1`, [email]);
  const user = rows.rows[0];
  if (!user || user.status !== "ACTIVE") return; // don't reveal whether the account exists

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await query(`INSERT INTO password_reset (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`, [
    randomUUID(),
    user.id,
    hashToken(token),
    expiresAt.toISOString(),
  ]);
  await mailer.send({
    to: email,
    subject: "Reset your Pranava HomeFlow password",
    text: `Reset your password: ${process.env.APP_URL ?? "http://localhost:5173"}/reset/${token}\n\nThis link expires in 1 hour.`,
  });
  await appendAuthEvent("auth.password_reset_requested", user.id, user.id, { email });
}

export async function completePasswordReset(input: { token: string; password: string }): Promise<void> {
  if (!input.token || !input.password) throw new AppError("validation", "token and password are required");
  const rows = await query<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    `SELECT id, user_id, expires_at, used_at FROM password_reset WHERE token_hash = $1`,
    [hashToken(input.token)]
  );
  const reset = rows.rows[0];
  if (!reset || reset.used_at || new Date(reset.expires_at) < new Date()) {
    throw new AppError("validation", "reset link is invalid or has expired", "token");
  }

  const passwordHash = await hashPassword(input.password);
  await query(`UPDATE "user" SET password_hash = $1 WHERE id = $2`, [passwordHash, reset.user_id]);
  await query(`UPDATE password_reset SET used_at = now() WHERE id = $1`, [reset.id]);
  await revokeAllSessionsForUser(reset.user_id);
  await appendAuthEvent("auth.password_reset_completed", reset.user_id, reset.user_id, {});
}
