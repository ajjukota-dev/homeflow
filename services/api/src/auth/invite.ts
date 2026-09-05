import { randomBytes, randomUUID, createHash } from "node:crypto";
import { query } from "../db";
import { AppError, type Actor } from "../authz/types";
import { buildActor } from "../authz/buildActor";
import { hashPassword } from "./password";
import { createSession, type SessionMeta } from "./session";
import { mailer } from "./mailer";
import { appendAuthEvent } from "./events";

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Rule 2: staff/customer invite — mails a single-use 72h link that sets their password. */
export async function issueInvite(userId: string, invitedBy: string, email: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await query(`INSERT INTO invite (id, user_id, token_hash, expires_at, invited_by) VALUES ($1,$2,$3,$4,$5)`, [
    randomUUID(),
    userId,
    hashToken(token),
    expiresAt.toISOString(),
    invitedBy,
  ]);
  await mailer.send({
    to: email,
    subject: "You're invited to Pranava HomeFlow",
    text: `Set your password to get started: ${process.env.APP_URL ?? "http://localhost:5173"}/invite/${token}\n\nThis link expires in 72 hours.`,
  });
  await appendAuthEvent("auth.invite_sent", invitedBy, userId, { email });
}

export interface AcceptInviteInput {
  token: string;
  password: string;
}

export interface AcceptInviteResult {
  token: string;
  expiresAt: Date;
  actor: Actor;
}

export async function acceptInvite(input: AcceptInviteInput, meta: SessionMeta = {}): Promise<AcceptInviteResult> {
  if (!input.token || !input.password) throw new AppError("validation", "token and password are required");
  const rows = await query<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    `SELECT id, user_id, expires_at, used_at FROM invite WHERE token_hash = $1`,
    [hashToken(input.token)]
  );
  const invite = rows.rows[0];
  if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
    throw new AppError("validation", "invite link is invalid or has expired", "token");
  }

  const passwordHash = await hashPassword(input.password);
  await query(`UPDATE "user" SET password_hash = $1, status = 'ACTIVE' WHERE id = $2`, [passwordHash, invite.user_id]);
  await query(`UPDATE invite SET used_at = now() WHERE id = $1`, [invite.id]);
  await appendAuthEvent("auth.invite_accepted", invite.user_id, invite.user_id, {});

  const actor = await buildActor(invite.user_id);
  if (!actor) throw new AppError("validation", "account could not be activated");
  const session = await createSession(invite.user_id, meta);
  return { token: session.token, expiresAt: session.expiresAt, actor };
}
