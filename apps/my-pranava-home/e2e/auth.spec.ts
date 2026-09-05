import { test, expect } from "@playwright/test";

// 01-identity-access.md Acceptance, portal: login as the seeded customer,
// wrong password error, logged-out gate. Runs logged out — visual.spec.ts
// covers the authenticated home screen via storageState.
test.use({ storageState: { cookies: [], origins: [] } });

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("logged out shows the sign-in screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong password shows an error and does not sign in", async ({ page }) => {
  await login(page, "customer@demo.pranava", "wrong-password");
  await expect(page.getByRole("alert")).toContainText(/incorrect email or password/i);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("customer signs in and lands on their booking's home screen", async ({ page }) => {
  await login(page, "customer@demo.pranava", "Demo@2026");
  await expect(page.getByRole("heading", { name: /Building your home/ })).toBeVisible();
});
