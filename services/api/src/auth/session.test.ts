import { beforeAll, describe, expect, it } from "vitest";
import { initDb, query } from "../db";
import { createSession, validateSessionToken, revokeSession, revokeAllSessionsForUser } from "./session";

describe("session", () => {
  beforeAll(async () => {
    await initDb();
  });

  async function userId(email: string): Promise<string> {
    const r = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
    return r.rows[0].id;
  }

  it("a created session validates back to the same actor", async () => {
    const id = await userId("qa@demo.pranava");
    const { token } = await createSession(id);
    const actor = await validateSessionToken(token);
    expect(actor?.user_id).toBe(id);
    expect(actor?.roles).toContain("QA");
  });

  it("an unknown token does not validate", async () => {
    expect(await validateSessionToken("not-a-real-token")).toBeNull();
  });

  it("logout revokes the session — it no longer validates", async () => {
    const id = await userId("fm@demo.pranava");
    const { token } = await createSession(id);
    await revokeSession(token);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("rule 3: password reset revokes every other session for the user", async () => {
    const id = await userId("banking@demo.pranava");
    const a = await createSession(id);
    const b = await createSession(id);
    await revokeAllSessionsForUser(id);
    expect(await validateSessionToken(a.token)).toBeNull();
    expect(await validateSessionToken(b.token)).toBeNull();
  });
});
