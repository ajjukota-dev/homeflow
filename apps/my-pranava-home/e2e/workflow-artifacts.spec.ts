import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

/** W12–W14 live shots for docs/handover/workflow-artifacts.md.
 *  `CAPTURE_ARTIFACTS=1` after db:reset — skipped in the default e2e suite. */
test.skip(!process.env.CAPTURE_ARTIFACTS, "set CAPTURE_ARTIFACTS=1 after db:reset");
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 90_000 });

const ARTIFACTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/handover/artifacts");
const shot = (name: string) => path.join(ARTIFACTS, `${name}.png`);

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Demo@2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("W12 See my home", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "customer@demo.pranava");
  await expect(page.getByRole("heading", { name: /^Hello, Ananya/ })).toBeVisible();
  await expect(page.getByText("V112")).toBeVisible();
  await expect(page.getByText(/TRUE_RISK|vendor_cost|vendor_contact/i)).toHaveCount(0);
  await page.screenshot({ path: shot("w12-home-1440"), fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: shot("w12-home-375"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Journey" }).click();
  await expect(page.getByRole("heading", { name: /Journey|Your journey/i }).or(page.getByText(/timeline|stage|will appear/i))).toBeVisible();
  await page.screenshot({ path: shot("w12-journey"), fullPage: true });
});

test("W13 Pay and sign", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "customer@demo.pranava");
  await expect(page.getByRole("heading", { name: /^Hello, Ananya/ })).toBeVisible();

  await page.getByRole("button", { name: "Payments" }).click();
  await expect(page.getByText(/TRUE_RISK/i)).toHaveCount(0);
  await page.screenshot({ path: shot("w13-payments"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: shot("w13-payments-375"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Documents" }).click();
  await page.screenshot({ path: shot("w13-documents"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: shot("w13-documents-375"), fullPage: true });
});

test("W14 Ishaan handover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "ishaan@demo.pranava");
  await expect(page.getByRole("heading", { name: /^Hello, Ishaan/ })).toBeVisible();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Handover" }).click();
  await page.screenshot({ path: shot("w14-ishaan-handover"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: shot("w14-ishaan-handover-375"), fullPage: true });
});

test("W14 Rohan passport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "rohan@demo.pranava");
  await expect(page.getByRole("heading", { name: /^Hello, Rohan/ })).toBeVisible();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Home Passport" }).click();
  await expect(page.getByRole("heading", { name: "Home Passport" })).toBeVisible();
  await page.screenshot({ path: shot("w14-rohan-passport"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: shot("w14-rohan-passport-375"), fullPage: true });
});
