import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, type DbLike } from "../events";
import { AppError, type Ctx } from "../authz/types";
import { clock } from "../ports/clock";
import { mailer } from "../mail";

// 12-escalations-notifications.md rule 5/6/7. `notification`/`notification_preference` are
// per-user, not module-gated — every staff role has READ on `notifications` in the seeded matrix
// (seed/permissions.ts) since a notification only ever belongs to its own recipient; enforced here
// by filtering on `ctx.actor.user_id`, the same "module grants READ, the row itself narrows it"
// shape 26-customer-portal's own home route already uses for a customer's own booking data.
//
// Rule 5's trigger list is only PARTIALLY wired, flagged not faked: `action.created`/
// `action.reassigned` (real, built:true events, 10) and `escalation.raised` (this spec's own, 12)
// are wired via `registerNotificationSubscribers`. `@mention` has no comment/mention system
// anywhere in this codebase. `evidence.verification_requested` has no corresponding event —
// `actions/core.ts`'s evidence upload never fires one, and that file is outside this spec's Files
// list to add one to. `commitment.at_risk` needs 13 (promise ledger), not built. `sla.due_soon` is
// a derived read-time status (06), not a stored event to subscribe to — `scanEscalations`
// (escalations/core.ts) notifies the tier owner directly at the point it detects the transition,
// which covers the same real-world outcome without inventing a new event type in 06's own files.

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_ref: { entity_type: string; entity_id: string } | null;
  read_at: string | null;
  created_at: string;
  channel: "IN_APP" | "EMAIL";
}

const NOTIFICATION_SELECT = `
  SELECT id, user_id, type, title, body, entity_ref, read_at::text AS read_at, created_at::text AS created_at, channel
    FROM notification
`;

export interface NotificationPreference {
  user_id: string;
  digest_time: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  email_on: "NONE" | "PRE_BREACH" | "ESCALATION" | "ALL";
  mentions_email: boolean;
}

const PREFERENCE_SELECT = `SELECT user_id, digest_time, quiet_hours_start, quiet_hours_end, email_on, mentions_email FROM notification_preference`;

async function getOrDefaultPreference(userId: string, handle: DbLike = db): Promise<NotificationPreference> {
  const r = await handle.query<NotificationPreference>(`${PREFERENCE_SELECT} WHERE user_id = $1`, [userId]);
  if (r.rows[0]) return { ...r.rows[0], mentions_email: Boolean(r.rows[0].mentions_email) };
  return { user_id: userId, digest_time: "08:30", quiet_hours_start: "21:00", quiet_hours_end: "08:00", email_on: "ESCALATION", mentions_email: true };
}

/** IST wall-clock "HH:MM" comparison, wrap-safe (21:00–08:00 crosses midnight). */
function isWithinQuietHours(nowHm: string, start: string, end: string): boolean {
  if (start === end) return false;
  if (start < end) return nowHm >= start && nowHm < end;
  return nowHm >= start || nowHm < end; // wraps midnight
}

function nowIstHm(): string {
  return clock.nowIst().toISOString().slice(11, 16);
}

/** Rule 5: creates the in-app row always; emails immediately unless quiet hours are in effect or
 *  the recipient's `email_on` preference excludes this notification's level — quiet-hours email is
 *  documented as deferred to the next window, but there's no scheduler anywhere in this codebase
 *  (same gap as 06/19/21/this file's own digest) to actually re-fire it, so a quiet-hours
 *  notification's email half is simply skipped, not queued, and that's logged here rather than
 *  silently claimed as "queued." */
export async function createNotification(
  input: { user_id: string; type: string; title: string; body?: string; entity_ref?: { entity_type: string; entity_id: string }; level?: "PRE_BREACH" | "ESCALATION" },
  handle: DbLike = db
): Promise<string> {
  const id = "ntf_" + randomUUID().slice(0, 8);
  await handle.query(
    `INSERT INTO notification (id, user_id, type, title, body, entity_ref, channel) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'IN_APP')`,
    [id, input.user_id, input.type, input.title, input.body ?? null, input.entity_ref ? JSON.stringify(input.entity_ref) : null]
  );
  await appendEvent(handle, {
    type: "notification.sent",
    entity_type: "notification",
    entity_id: id,
    payload: { user_id: input.user_id, type: input.type, channel: "IN_APP" },
    actor_user_id: null,
    actor_kind: "SYSTEM",
  });

  const pref = await getOrDefaultPreference(input.user_id, handle);
  const level = input.level ?? "ALL";
  const emailAllowed = pref.email_on === "ALL" || (pref.email_on !== "NONE" && pref.email_on === level);
  if (emailAllowed && !isWithinQuietHours(nowIstHm(), pref.quiet_hours_start, pref.quiet_hours_end)) {
    const userRow = await handle.query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [input.user_id]);
    if (userRow.rows[0]) {
      await mailer.send({ to: userRow.rows[0].email, subject: input.title, text: input.body ?? input.title, html: `<p>${input.body ?? input.title}</p>` });
      await handle.query(`INSERT INTO notification (id, user_id, type, title, body, entity_ref, channel) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'EMAIL')`, [
        "ntf_" + randomUUID().slice(0, 8), input.user_id, input.type, input.title, input.body ?? null, input.entity_ref ? JSON.stringify(input.entity_ref) : null,
      ]);
    }
  }
  return id;
}

export async function listNotifications(ctx: Ctx, unreadOnly = false): Promise<NotificationRow[]> {
  const where = unreadOnly ? "WHERE user_id = $1 AND read_at IS NULL" : "WHERE user_id = $1";
  const r = await db.query<NotificationRow>(`${NOTIFICATION_SELECT} ${where} ORDER BY created_at DESC`, [ctx.actor.user_id]);
  return r.rows;
}

export async function markNotificationRead(id: string, ctx: Ctx): Promise<void> {
  const r = await db.query<{ user_id: string }>(`SELECT user_id FROM notification WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new AppError("not_found", "notification not found");
  if (r.rows[0].user_id !== ctx.actor.user_id) throw new AppError("forbidden", "not your notification"); // rule 5: no self-notify guard needed here, but reading someone else's is never allowed
  await db.query(`UPDATE notification SET read_at = now() WHERE id = $1`, [id]);
}

export async function getNotificationPreferences(ctx: Ctx): Promise<NotificationPreference> {
  return getOrDefaultPreference(ctx.actor.user_id);
}

export async function setNotificationPreferences(input: Partial<Omit<NotificationPreference, "user_id">>, ctx: Ctx): Promise<NotificationPreference> {
  const current = await getOrDefaultPreference(ctx.actor.user_id);
  const next = { ...current, ...input };
  await db.query(
    `INSERT INTO notification_preference (user_id, digest_time, quiet_hours_start, quiet_hours_end, email_on, mentions_email)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET digest_time = $2, quiet_hours_start = $3, quiet_hours_end = $4, email_on = $5, mentions_email = $6`,
    [ctx.actor.user_id, next.digest_time, next.quiet_hours_start, next.quiet_hours_end, next.email_on, next.mentions_email]
  );
  return next;
}

/** Rule 5's daily digest — no scheduler exists (see header), directly callable per user with a
 *  controlled `asOf`. Summarizes unread notifications + open escalations at the user's tier since
 *  their last digest send; "My Day counts" (rule 5's other summary ingredient) needs 11 (My Day),
 *  not built — flagged, omitted rather than faked. */
export async function sendDigest(userId: string, asOf: string = new Date().toISOString()): Promise<{ sent: boolean; unread: number; escalations: number }> {
  const unread = await db.query<{ count: string }>(`SELECT count(*)::text FROM notification WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  const escalations = await db.query<{ count: string }>(`SELECT count(*)::text FROM escalation WHERE owner_user_id = $1 AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`, [userId]);
  const unreadCount = Number(unread.rows[0]!.count);
  const escalationCount = Number(escalations.rows[0]!.count);
  if (unreadCount === 0 && escalationCount === 0) return { sent: false, unread: 0, escalations: 0 };

  const userRow = await db.query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [userId]);
  if (!userRow.rows[0]) return { sent: false, unread: unreadCount, escalations: escalationCount };
  const text = `You have ${unreadCount} unread notification(s) and ${escalationCount} open escalation(s).`;
  await mailer.send({ to: userRow.rows[0].email, subject: "HomeFlow daily digest", text, html: `<p>${text}</p>` });
  await appendEvent(db, {
    type: "digest.sent",
    entity_type: "user",
    entity_id: userId,
    payload: { unread: unreadCount, escalations: escalationCount, as_of: asOf },
    actor_user_id: null,
    actor_kind: "SYSTEM",
  });
  return { sent: true, unread: unreadCount, escalations: escalationCount };
}
