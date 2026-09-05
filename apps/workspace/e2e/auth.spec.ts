import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 01-identity-access.md Acceptance: login as each demo role; a Sales user sees
// no Site write controls; wrong password error; logout; the live invite flow.
// Runs logged out — the file's tests each authenticate through the real UI.
test.use({ storageState: { cookies: [], origins: [] } });

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const OUTBOX_DIR = path.join(__dirname, "../../../services/api/.data/mail");

async function mailTo(email: string): Promise<{ text: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const files = await readdir(OUTBOX_DIR).catch(() => [] as string[]);
    for (const file of files.sort().reverse()) {
      const mail = JSON.parse(await readFile(path.join(OUTBOX_DIR, file), "utf-8"));
      if (mail.to === email) return mail;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no mail found for ${email}`);
}

for (const s of sizes) {
  test(`SALES sees the Sales workspace and no Site write controls @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await login(page, "sales@demo.pranava", "Demo@2026");
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Project \/ Site/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Site$/ })).toHaveCount(0);
    await page.screenshot({ path: shot(`auth-sales-${s.name}`), fullPage: true });
  });
}

test("SITE lands on the Project / Site workspace", async ({ page }) => {
  await login(page, "site@demo.pranava", "Demo@2026");
  await expect(page.getByRole("heading", { name: "Unit Progress Control" })).toBeVisible();
});

// Rule 9 "workspace opens in the user's default Project/home view", walked
// across every seeded demo login (not just SALES/SITE above) — this is what
// caught CUSTOMISATION landing on an empty-nav Control tower before the fix.
const ROLE_LANDINGS: [string, string][] = [
  ["management@demo.pranava", "Control tower"],
  ["crm@demo.pranava", "CRM · Relationship"],
  ["accounts@demo.pranava", "Collections"],
  ["banking@demo.pranava", "Collections"],
  ["legal@demo.pranava", "Document factory"],
  ["registration@demo.pranava", "Document factory"],
  ["qa@demo.pranava", "QA & handover"],
  ["customisation@demo.pranava", "CRM · Relationship"],
  ["fm@demo.pranava", "After keys"],
  ["superadmin@demo.pranava", "Unit Progress Control"],
];
for (const [email, heading] of ROLE_LANDINGS) {
  test(`${email} lands on "${heading}"`, async ({ page }) => {
    await login(page, email, "Demo@2026");
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  });
}

// CUSTOMISATION is seeded READ-only on customer_overview/customer_journey
// (no sales_handover grant) but its home view is the CRM tab, which also
// carries the booking Accept/Return controls — those are hidden client-side
// (CrmQueue.tsx canAccept) since no route enforces this server-side yet.
test("CUSTOMISATION sees Active customers but no booking Accept/Return controls", async ({ page }) => {
  await login(page, "customisation@demo.pranava", "Demo@2026");
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active customers" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Acceptance queue" })).toHaveCount(0);
  // exact: the sidebar's own CRM nav button is named "CRM / RM Accepts, owns
  // customers" — a substring match on "Accept" would false-positive on it.
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
});

test("wrong password shows an error and does not sign in", async ({ page }) => {
  await login(page, "sales@demo.pranava", "wrong-password");
  await expect(page.getByRole("alert")).toContainText(/incorrect email or password/i);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("logout returns to the sign-in screen", async ({ page }) => {
  await login(page, "crm@demo.pranava", "Demo@2026");
  await expect(page.getByText("Priya Nair")).toBeVisible(); // header user menu
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("live invite: Admin invites a fresh email, mail arrives, link sets password, lands in Management", async ({ page }) => {
  await login(page, "superadmin@demo.pranava", "Demo@2026");
  await page.getByRole("button", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();

  const email = `cfo-${Date.now()}@example.com`;
  await page.getByRole("button", { name: "Invite user" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill("CFO Guest");
  await page.getByRole("checkbox", { name: "MANAGEMENT" }).check();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(email)).toBeVisible();

  const mail = await mailTo(email);
  const token = mail.text.match(/\/invite\/([\w-]+)/)?.[1];
  expect(token).toBeTruthy();

  await page.goto(`/invite/${token}`);
  await page.getByLabel("Password", { exact: true }).fill("Cfo@2026Guest");
  await page.getByLabel("Confirm password").fill("Cfo@2026Guest");
  await page.getByRole("button", { name: "Set password and continue" }).click();

  await expect(page.getByRole("heading", { name: "Control tower" })).toBeVisible(); // "lands in Management"
});
