import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initDb } from "../db";
import { requestPasswordReset, completePasswordReset } from "./reset";
import { login } from "./login";
import { createSession } from "./session";
import { query } from "../db";
import { validateSessionToken } from "./session";

const OUTBOX_DIR = fileURLToPath(new URL("../../.data/mail", import.meta.url));

async function latestMail(): Promise<{ to: string; text: string }> {
  const files = await readdir(OUTBOX_DIR);
  const newest = files.sort().at(-1)!;
  return JSON.parse(await readFile(path.join(OUTBOX_DIR, newest), "utf-8"));
}

// Rule 3: email → single-use 1h token → new password; all other sessions revoked.
describe("password reset", () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await rm(OUTBOX_DIR, { recursive: true, force: true });
  });

  it("rule 3: reset sets a new password and logs in with it", async () => {
    await requestPasswordReset({ email: "legal@demo.pranava" });
    const mail = await latestMail();
    const token = mail.text.match(/\/reset\/([\w-]+)/)?.[1]!;

    await completePasswordReset({ token, password: "NewLegalPass@1" });
    const result = await login({ email: "legal@demo.pranava", password: "NewLegalPass@1" });
    expect(result.actor.roles).toContain("LEGAL");
  });

  it("rule 3: completing a reset revokes the user's other sessions", async () => {
    const userRow = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'registration@demo.pranava'`);
    const { token: oldSession } = await createSession(userRow.rows[0].id);

    await requestPasswordReset({ email: "registration@demo.pranava" });
    const mail = await latestMail();
    const token = mail.text.match(/\/reset\/([\w-]+)/)?.[1]!;
    await completePasswordReset({ token, password: "AnotherPass@2" });

    expect(await validateSessionToken(oldSession)).toBeNull();
  });

  it("does not reveal whether an email exists (no mail, no error)", async () => {
    await expect(requestPasswordReset({ email: "nobody@example.com" })).resolves.toBeUndefined();
  });

  it("a reused reset token is rejected", async () => {
    await requestPasswordReset({ email: "site@demo.pranava" });
    const mail = await latestMail();
    const token = mail.text.match(/\/reset\/([\w-]+)/)?.[1]!;
    await completePasswordReset({ token, password: "SitePass@3" });
    await expect(completePasswordReset({ token, password: "SitePass@4" })).rejects.toMatchObject({ code: "validation" });
  });
});
