import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

test("My Pranava Home @ mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Building your home/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your paperwork" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your keys" })).toBeVisible();
  await expect(page.getByText(/PRM\/KA\/RERA/)).toBeVisible();
  await expect(page.getByText(/this milestone is now due|on your payment plan|becomes due when/i).first()).toBeVisible();
  await page.screenshot({ path: shot("home-mobile"), fullPage: true });
});

test("My Pranava Home @ desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Building your home/ })).toBeVisible();
  await page.screenshot({ path: shot("home-desktop"), fullPage: true });
});
