import { randomUUID } from "node:crypto";
import { query } from "../db";

// Rule 11: login_succeeded, login_failed, logout, password_reset_requested/completed,
// invite_sent/accepted, session_revoked, permission_matrix_changed, assignment_changed.
export type AuthEventType =
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "auth.invite_sent"
  | "auth.invite_accepted"
  | "auth.session_revoked"
  | "access.permission_matrix_changed"
  | "access.assignment_changed";

export async function appendAuthEvent(
  type: AuthEventType,
  actorUserId: string | null,
  targetUserId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await query(`INSERT INTO auth_event (id, type, actor_user_id, target_user_id, metadata) VALUES ($1,$2,$3,$4,$5)`, [
    randomUUID(),
    type,
    actorUserId,
    targetUserId,
    JSON.stringify(metadata),
  ]);
}
