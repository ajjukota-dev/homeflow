import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initDb, query } from "../db";
import { requestPasswordReset, completePasswordReset } from "./reset";
import { login } from "./login";
import { createSession, validateSessionToken } from "./session";

// Shared with invite.test.ts (and, in CI, other files) — both write to the same
// outbox concurrently, so find mail by recipient, never by "clear + latest".
const OUTBOX_DIR = fileURLToPath(new URL("../../.data/mail", import.meta.url));

async function mailTo(email: string): Promise<{ to: string; text: string }> {
  await mkdir(OUTBOX_DIR, { recursive: true });
  for (let attempt = 0; attempt < 20; attempt++) {
    const files = await readdir(OUTBOX_DIR);
    for (const file of files.sort().reverse()) {
      const mail = JSON.parse(await readFile(path.join(OUTBOX_DIR, file), "utf-8"));
      if (mail.to === email) return mail;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no mail found for ${email}`);
}

// Rule 3: email → single-use 1h token → new password; all other sessions revoked.
describe("password reset", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("rule 3: reset sets a new password and logs in with it", async () => {
    await requestPasswordReset({ email: "legal@demo.pranava" });
    const mail = await mailTo("legal@demo.pranava");
    const token = mail.text.match(/\/reset\/([\w-]+)/)?.[1]!;

    await completePasswordReset({ token, password: "NewLegalPass@1" });
    const result = await login({ email: "legal@demo.pranava", password: "NewLegalPass@1" });
    expect(result.actor.roles).toContain("LEGAL");
  });

  it("rule 3: completing a reset revokes the user's other sessions", async () => {
    const userRow = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'registration@demo.pranava'`);
    const { token: oldSession } = await createSession(userRow.rows[0].id);

    await requestPasswordReset({ email: "registration@demo.pranava" });
    const mail = await mailTo("registration@demo.pranava");
    const token = mail.text.match(/\/reset\/([\w-]+)/)?.[1]!;
    await completePasswordReset({ token, password: "AnotherPass@2" });

    expect(await validateSessionToken(oldSession)).toBeNull();
  });

  it("does not reveal whether an email exists (no mail, no error)", async () => {
    await expect(requestPasswordReset({ email: "nobody@example.com" })).resolves.toBeUndefined();
  });

  it("allows about 5 reset requests per hour per IP and email, then limits both known and unknown emails the same way", async () => {
    const ip = "203.0.113.10";
    const known = "qa@demo.pranava";
    const unknown = "nobody-throttle@example.com";
    const start = Date.parse("2026-09-25T08:00:00.000Z");

    for (let i = 0; i < 5; i++) {
      await expect(requestPasswordReset({ email: unknown, ip }, start + i)).resolves.toBeUndefined();
      await expect(requestPasswordReset({ email: known, ip }, start + i)).resolves.toBeUndefined();
    }

    const before = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM password_reset pr JOIN "user" u ON u.id = pr.user_id WHERE u.email = $1`,
      [known]
    );

    const unknownLimited = await requestPasswordReset({ email: unknown, ip }, start + 5).catch((e) => e);
    const knownLimited = await requestPasswordReset({ email: known, ip }, start + 5).catch((e) => e);
    expect(unknownLimited).toMatchObject({ code: "rate_limited" });
    expect(knownLimited).toMatchObject({ code: "rate_limited" });
    expect(unknownLimited.message).toBe(knownLimited.message);

    const after = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM password_reset pr JOIN "user" u ON u.id = pr.user_id WHERE u.email = $1`,
      [known]
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);

    await expect(requestPasswordReset({ email: known, ip }, start + 60 * 60 * 1000 + 1)).resolves.toBeUndefined();
  });

  it("a normal reset still completes and the token expires after 1 hour", async () => {
    const before = Date.now();
    await requestPasswordReset({ email: "fm@demo.pranava", ip: "203.0.113.20" });
    const mail = await mailTo("fm@demo.pranava");
    const token = mail.text.match(/\/reset\/([\w-]+)/)?.[1]!;
    const row = await query<{ expires_at: string }>(
      `SELECT expires_at::text AS expires_at FROM password_reset pr
         JOIN "user" u ON u.id = pr.user_id
        WHERE u.email = 'fm@demo.pranava'
        ORDER BY pr.created_at DESC LIMIT 1`
    );
    const ttl = new Date(row.rows[0]!.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    expect(ttl).toBeLessThan(61 * 60 * 1000);

    await completePasswordReset({ token, password: "FmPass@2026" });
    const result = await login({ email: "fm@demo.pranava", password: "FmPass@2026" });
    expect(result.actor.roles).toContain("FM");
  });

  it("a reused reset token is rejected", async () => {
    await requestPasswordReset({ email: "site@demo.pranava" });
    const mail = await mailTo("site@demo.pranava");
    const token = mail.text.match(/\/reset\/([\w-]+)/)?.[1]!;
    await completePasswordReset({ token, password: "SitePass@3" });
    await expect(completePasswordReset({ token, password: "SitePass@4" })).rejects.toMatchObject({ code: "validation" });
  });
});
