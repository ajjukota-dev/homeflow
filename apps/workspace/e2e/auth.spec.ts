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
