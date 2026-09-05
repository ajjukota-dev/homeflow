import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "../db";
import { login } from "./login";
import { AppError } from "../authz/types";
import { resetRateLimitStoreForTests } from "./rateLimit";
import { DEMO_PASSWORD } from "../seed/users";

// Rule 1: email+password → argon2id verify → new session; 5 failures/15min/email → 429.
describe("login", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("rule 1: correct demo credentials return a session token and actor", async () => {
    const result = await login({ email: "sales@demo.pranava", password: DEMO_PASSWORD });
    expect(result.token).toHaveLength(43); // 32 random bytes, base64url
    expect(result.actor.roles).toContain("SALES");
  });

  it("wrong password fails with a validation error", async () => {
    resetRateLimitStoreForTests();
    await expect(login({ email: "sales@demo.pranava", password: "wrong" })).rejects.toMatchObject({ code: "validation" });
  });

  it("rule 1: 5 failures in 15 minutes → rate_limited (429)", async () => {
    resetRateLimitStoreForTests();
    const email = "crm@demo.pranava";
    for (let i = 0; i < 5; i++) {
      await expect(login({ email, password: "wrong" })).rejects.toMatchObject({ code: "validation" });
    }
    const err = await login({ email, password: "wrong" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("rate_limited");
  });

  it("an unknown email fails the same way as a wrong password (no enumeration)", async () => {
    resetRateLimitStoreForTests();
    await expect(login({ email: "nobody@demo.pranava", password: "whatever" })).rejects.toMatchObject({ code: "validation" });
  });
});
