import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// Amarsh #8 — human labels instead of raw enums. These are the 3 bugs from
// TODO.md, asserted as absent (case-sensitive: the fix and the raw string
// differ only by capitalisation, so a case-insensitive match proves nothing).
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

for (const s of sizes) {
  test(`Sales inventory has no raw sale_status @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Sales/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /Sales/ }).first().click();
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(page.getByText("Handed over", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Handed_over", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: shot(`labels-sales-${s.name}`), fullPage: true });
  });

  test(`QA/Handover has no raw gate type · state @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /^QA/ }).first().click();
    await expect(page.getByRole("heading", { name: "QA & handover" })).toBeVisible();
    await expect(page.getByText(/Financial clearance/).first()).toBeVisible();
    await expect(page.getByText("financial · open", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: shot(`labels-qa-${s.name}`), fullPage: true });
  });

  test(`Legal shows no raw registration status @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /^Legal/ }).first().click();
    await expect(page.getByRole("heading", { name: "Document factory" })).toBeVisible();
    await expect(page.getByText(/Readiness in progress/).first()).toBeVisible();
    await expect(page.getByText("readiness in progress", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: shot(`labels-legal-${s.name}`), fullPage: true });
  });
}
