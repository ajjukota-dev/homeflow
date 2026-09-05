import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initDb } from "../db";
import { createUser } from "./adminUsers";
import { acceptInvite } from "./invite";
import type { Ctx } from "../authz/types";

const OUTBOX_DIR = fileURLToPath(new URL("../../.data/mail", import.meta.url));

async function latestMail(): Promise<{ to: string; subject: string; text: string }> {
  const files = await readdir(OUTBOX_DIR);
  const newest = files.sort().at(-1)!;
  return JSON.parse(await readFile(path.join(OUTBOX_DIR, newest), "utf-8"));
}

function ctxFor(roles: string[]): Ctx {
  const userId = roles.includes("SUPER_ADMIN") ? "user_superadmin" : "user_sales";
  return { actor: { user_id: userId, display_name: "Admin", kind: "STAFF", roles, project_ids: "ALL", default_project_id: null } };
}

// Acceptance: "Admin invites a fresh email → mail arrives via SMTP (file adapter
// here) → link sets password → lands in Management." Rule 2: no self-signup.
describe("invite (live smoke, file mailer)", () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await rm(OUTBOX_DIR, { recursive: true, force: true });
  });

  it("SUPER_ADMIN invites a fresh email; the mail carries a working set-password link", async () => {
    const email = `cfo-${Date.now()}@example.com`;
    await createUser({ email, display_name: "CFO Guest", roles: ["MANAGEMENT"] }, ctxFor(["SUPER_ADMIN"]));

    const mail = await latestMail();
    expect(mail.to).toBe(email);
    const token = mail.text.match(/\/invite\/([\w-]+)/)?.[1];
    expect(token).toBeTruthy();

    const { actor } = await acceptInvite({ token: token!, password: "Cfo@2026Pass" });
    expect(actor.roles).toContain("MANAGEMENT"); // "lands in Management"
  });

  it("rule 2: SALES cannot invite (no administration write)", async () => {
    await expect(
      createUser({ email: "someone@example.com", display_name: "Someone", roles: ["SALES"] }, ctxFor(["SALES"]))
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("an expired/unknown invite token is rejected", async () => {
    await expect(acceptInvite({ token: "does-not-exist", password: "whatever123" })).rejects.toMatchObject({ code: "validation" });
  });
});
