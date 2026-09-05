import { createHash, randomBytes } from "node:crypto";
import { query } from "../db";
import { buildActor } from "../authz/buildActor";
import { appendAuthEvent } from "./events";
import type { Actor } from "../authz/types";

// Data model: session.id stores sha256(token) hex — the raw token only ever
// lives in the httpOnly cookie (01-identity-access.md Data, Rule 1).
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const STAFF_IDLE_MS = 12 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export async function createSession(userId: string, meta: SessionMeta = {}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url"); // 256-bit
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  await query(
    `INSERT INTO session (id, user_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
    [hashToken(token), userId, expiresAt.toISOString(), meta.ip ?? null, meta.userAgent ?? null]
  );
  return { token, expiresAt };
}

/** Validates a raw cookie token: not revoked, not expired, not idle (STAFF only); slides the window. */
export async function validateSessionToken(token: string): Promise<Actor | null> {
  const id = hashToken(token);
  const r = await query<{ user_id: string; expires_at: string; last_seen_at: string; revoked_at: string | null }>(
    `SELECT user_id, expires_at, last_seen_at, revoked_at FROM session WHERE id = $1`,
    [id]
  );
  const row = r.rows[0];
  if (!row || row.revoked_at) return null;
  const now = new Date();
  if (new Date(row.expires_at) < now) return null;

  const actor = await buildActor(row.user_id);
  if (!actor) return null;

  if (actor.kind === "STAFF" && now.getTime() - new Date(row.last_seen_at).getTime() > STAFF_IDLE_MS) {
    await revokeSessionById(id);
    // Rule 11: system-initiated revocation (not the user's own logout) is a
    // distinct event; actor_user_id is null because no one acted, session
    // idled out.
    await appendAuthEvent("auth.session_revoked", null, row.user_id, { reason: "idle_timeout" });
    return null;
  }

  const newExpiry = new Date(now.getTime() + THIRTY_DAYS_MS);
  await query(`UPDATE session SET last_seen_at = $1, expires_at = $2 WHERE id = $3`, [now.toISOString(), newExpiry.toISOString(), id]);
  return actor;
}

async function revokeSessionById(id: string): Promise<void> {
  await query(`UPDATE session SET revoked_at = now() WHERE id = $1`, [id]);
}

export async function revokeSession(token: string): Promise<void> {
  await revokeSessionById(hashToken(token));
}

/** Rule 3: password reset revokes every other session for the user. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await query(`UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  await appendAuthEvent("auth.session_revoked", userId, userId, { reason: "password_reset" });
}
