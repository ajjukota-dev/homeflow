import { beforeAll, describe, expect, it } from "vitest";
import { initDb, query } from "../db";
import { login } from "./login";
import { logout } from "./logout";
import { createSession, validateSessionToken, revokeAllSessionsForUser } from "./session";
import { requestPasswordReset, completePasswordReset } from "./reset";
import type { AuthEventType } from "./events";

// Rule 11: every listed event type lands a row in `auth_event`. Each sub-test
// exercises the real code path (not appendAuthEvent directly) so a regression
// like "logout never sees an actor" or "idle timeout never fires an event"
// fails here instead of only in e2e.
describe("rule 11: auth events", () => {
  beforeAll(async () => {
    await initDb();
  });

  async function userId(email: string): Promise<string> {
    const r = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
    return r.rows[0].id;
  }

  async function latestEvent(type: AuthEventType, targetUserId: string) {
    const r = await query<{ actor_user_id: string | null; target_user_id: string | null }>(
      `SELECT actor_user_id, target_user_id FROM auth_event WHERE type = $1 AND target_user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [type, targetUserId]
    );
    return r.rows[0];
  }

  // accounts@demo.pranava: not used by login.test.ts/reset.test.ts, so its
  // password_hash and login history stay untouched by concurrent test files.
  it("auth.login_succeeded is recorded on a successful login", async () => {
    const id = await userId("accounts@demo.pranava");
    await login({ email: "accounts@demo.pranava", password: "Demo@2026" });
    expect(await latestEvent("auth.login_succeeded", id)).toMatchObject({ actor_user_id: id });
  });

  it("auth.login_failed is recorded on a wrong password", async () => {
    const id = await userId("accounts@demo.pranava");
    await expect(login({ email: "accounts@demo.pranava", password: "wrong" })).rejects.toMatchObject({ code: "validation" });
    expect(await latestEvent("auth.login_failed", id)).toMatchObject({ target_user_id: id });
  });

  it("auth.logout is recorded even though /api/auth/logout runs before requireSession — the route resolves the actor from the cookie itself", async () => {
    const id = await userId("registration@demo.pranava");
    const { token } = await createSession(id);
    const actor = await validateSessionToken(token); // what the route does before calling logout()
    await logout(token, actor);
    expect(await latestEvent("auth.logout", id)).toMatchObject({ actor_user_id: id, target_user_id: id });
  });

  it("auth.session_revoked is recorded when a STAFF session idles out", async () => {
    // customisation@demo.pranava: no other test file creates sessions for it,
    // so the user-scoped last_seen_at UPDATE below can't race another file's session.
    const id = await userId("customisation@demo.pranava");
    const { token } = await createSession(id);
    // Force the session to look 13h stale (idle timeout is 12h) without waiting.
    await query(`UPDATE session SET last_seen_at = now() - interval '13 hours' WHERE user_id = $1`, [id]);
    expect(await validateSessionToken(token)).toBeNull();
    expect(await latestEvent("auth.session_revoked", id)).toMatchObject({ target_user_id: id });
  });

  it("auth.session_revoked is recorded when a password reset revokes every session", async () => {
    const id = await userId("management@demo.pranava");
    await createSession(id);
    await revokeAllSessionsForUser(id);
    expect(await latestEvent("auth.session_revoked", id)).toMatchObject({ target_user_id: id });
  });

  it("auth.password_reset_requested and auth.password_reset_completed are recorded", async () => {
    const email = "qa@demo.pranava";
    const id = await userId(email);
    await requestPasswordReset({ email });
    expect(await latestEvent("auth.password_reset_requested", id)).toMatchObject({ actor_user_id: id });

    const r = await query<{ token_hash: string }>(`SELECT token_hash FROM password_reset WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]);
    expect(r.rows[0]).toBeTruthy();
    // completePasswordReset only accepts the raw token (we only stored its
    // hash) — go through the mailer outbox is covered by reset.test.ts; here
    // we only need one row in auth_event, so drive it via a fresh raw token
    // inserted the same way requestPasswordReset does.
    const { randomBytes, createHash, randomUUID } = await import("node:crypto");
    const raw = randomBytes(32).toString("base64url");
    await query(`INSERT INTO password_reset (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`, [
      randomUUID(),
      id,
      createHash("sha256").update(raw).digest("hex"),
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ]);
    await completePasswordReset({ token: raw, password: "NewPass@2026" });
    expect(await latestEvent("auth.password_reset_completed", id)).toMatchObject({ actor_user_id: id });
  });
});
