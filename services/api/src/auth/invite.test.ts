import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "../db";
import { createUser } from "./adminUsers";
import { acceptInvite } from "./invite";
import type { Ctx } from "../authz/types";

// Shared with reset.test.ts (and, in CI, other files) — both write to the same
// outbox concurrently, so find mail by recipient, never by "clear + latest".
const OUTBOX_DIR = fileURLToPath(new URL("../../.data/mail", import.meta.url));

async function mailTo(email: string): Promise<{ to: string; subject: string; text: string }> {
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

  it("SUPER_ADMIN invites a fresh email; the mail carries a working set-password link", async () => {
    const email = `cfo-${Date.now()}@example.com`;
    await createUser({ email, display_name: "CFO Guest", roles: ["MANAGEMENT"] }, ctxFor(["SUPER_ADMIN"]));

    const mail = await mailTo(email);
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
