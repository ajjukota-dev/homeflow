import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readdirSync, rmSync } from "node:fs";
import { initDb, db } from "../db";
import { ctxWithRoles } from "../authz/test-helpers";
import { createNotification, listNotifications, markNotificationRead, getNotificationPreferences, setNotificationPreferences, sendDigest } from "./core";
import type { Ctx } from "../authz/types";

// 12-escalations-notifications.md rule 5/6/7. Real seeded demo users (seed/users.ts) — notification.user_id
// FKs to "user"(id), same reason loans/core.test.ts's staffCtx overrides ctxWithRoles()'s default
// synthetic "test_user" id.
function ctxAs(userId: string): Ctx {
  return { actor: { ...ctxWithRoles(["BANKING"]).actor, user_id: userId } };
}
const banking = ctxAs("user_banking");
const accounts = ctxAs("user_accounts");

const MAIL_DIR = "./.data/notifications-test-mail";

beforeAll(async () => {
  await initDb();
});

beforeEach(() => {
  process.env.MAIL_DIR = MAIL_DIR;
});

afterEach(() => {
  rmSync(MAIL_DIR, { recursive: true, force: true });
  delete process.env.MAIL_DIR;
});

function emlCount(): number {
  try {
    return readdirSync(MAIL_DIR).filter((f) => f.endsWith(".eml")).length;
  } catch {
    return 0;
  }
}

describe("createNotification — rule 5", () => {
  it("always writes the in-app row, and emails immediately when the level matches preference and it's not quiet hours", async () => {
    await setNotificationPreferences({ email_on: "ALL", quiet_hours_start: "00:00", quiet_hours_end: "00:00" }, banking); // start===end -> never quiet, per core.ts's isWithinQuietHours
    const id = await createNotification({ user_id: "user_banking", type: "escalation.raised", title: "Test escalation", level: "ESCALATION" });
    expect(id).toMatch(/^ntf_/);

    const list = await listNotifications(banking);
    expect(list.some((n) => n.id === id)).toBe(true);
    expect(emlCount()).toBe(1);

    const evt = await db.query(`SELECT type FROM event WHERE type = 'notification.sent' AND entity_id = $1`, [id]);
    expect(evt.rows).toHaveLength(1);
  });

  it("skips the email half during quiet hours but still writes the in-app row", async () => {
    await setNotificationPreferences({ email_on: "ALL", quiet_hours_start: "00:00", quiet_hours_end: "23:59" }, accounts);
    const id = await createNotification({ user_id: "user_accounts", type: "action.created", title: "Quiet hours test" });
    const list = await listNotifications(accounts);
    expect(list.some((n) => n.id === id)).toBe(true);
    expect(emlCount()).toBe(0);
  });

  it("respects email_on level matching — a NONE preference sends no email regardless of level", async () => {
    await setNotificationPreferences({ email_on: "NONE", quiet_hours_start: "00:00", quiet_hours_end: "00:00" }, banking);
    await createNotification({ user_id: "user_banking", type: "escalation.raised", title: "Should not email", level: "ESCALATION" });
    expect(emlCount()).toBe(0);
  });
});

describe("markNotificationRead", () => {
  it("marks the caller's own notification read; refuses someone else's", async () => {
    await setNotificationPreferences({ email_on: "NONE" }, banking);
    const id = await createNotification({ user_id: "user_banking", type: "action.created", title: "For banking" });

    await expect(markNotificationRead(id, accounts)).rejects.toThrow(/not your notification/);
    await markNotificationRead(id, banking);
    const unreadOnly = await listNotifications(banking, true);
    expect(unreadOnly.some((n) => n.id === id)).toBe(false);
  });
});

describe("notification preferences — get/set roundtrip", () => {
  it("returns real defaults when unset, and persists a real update", async () => {
    const fresh = ctxAs("user_management");
    const defaults = await getNotificationPreferences(fresh);
    expect(defaults.digest_time).toBe("08:30");
    expect(defaults.quiet_hours_start).toBe("21:00");

    const updated = await setNotificationPreferences({ digest_time: "09:00", email_on: "ALL" }, fresh);
    expect(updated.digest_time).toBe("09:00");
    expect(updated.email_on).toBe("ALL");
    const reread = await getNotificationPreferences(fresh);
    expect(reread.digest_time).toBe("09:00");
  });
});

describe("sendDigest — rule 5's daily digest", () => {
  it("sends nothing when there's nothing to summarize, and a real digest once there is", async () => {
    const empty = await sendDigest("user_legal");
    expect(empty.sent).toBe(false);

    await createNotification({ user_id: "user_legal", type: "action.created", title: "One unread" });
    const result = await sendDigest("user_legal");
    expect(result.sent).toBe(true);
    expect(result.unread).toBeGreaterThanOrEqual(1);

    const evt = await db.query(`SELECT type, payload FROM event WHERE type = 'digest.sent' AND entity_id = 'user_legal'`);
    expect(evt.rows.length).toBeGreaterThan(0);
  });
});
