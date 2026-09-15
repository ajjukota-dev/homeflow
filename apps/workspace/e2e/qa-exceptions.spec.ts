import { test, expect } from "@playwright/test";

// 15-qa-evidence-snags.md — site vs QA acts + exception queue on the QA staff path.
// Locators on main; { exact: true } on Retry.

test("QA: site declaration is distinct from QA verify; exception queue is a row list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^QA/ }).first().click();
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "QA & handover" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Site declaration vs QA verify" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "QA exception queue" })).toBeVisible();
  await expect(main.getByRole("button", { name: /Site declare / }).first()).toBeVisible();
  await expect(main.getByRole("button", { name: /QA verify / }).first()).toBeVisible();
});

test("QA exception queue: empty state is not a spinner", async ({ page }) => {
  await page.route("**/api/projects/*/qa/exceptions", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^QA/ }).first().click();
  const main = page.locator("main");
  await expect(main.getByText("No QA exceptions for this project.")).toBeVisible();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
});

test("QA exception queue: error state is not a spinner", async ({ page }) => {
  await page.route("**/api/projects/*/qa/exceptions", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ errors: [{ code: "internal", message: "boom" }] }),
    })
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^QA/ }).first().click();
  const main = page.locator("main");
  await expect(main.getByText("Couldn't load the exception queue.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
});
