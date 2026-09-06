import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 20-cash-forecast.md Screens: Cash Flow Planner, Collections Forecast, Portfolio Comparison —
// all three read real demand rows from the seeded East Crest project (p_eastcrest, superadmin's
// default_project_id) via getForecast's read-time derive (rule 1), not fixtures.
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

for (const s of sizes) {
  test(`Cash Flow Planner renders the BASE waterfall @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /^(Cash Flow Planner|Planner)/ }).first().click();
    await expect(page.getByRole("heading", { name: "Cash Flow Planner" })).toBeVisible();
    await expect(page.getByText("Opening outstanding")).toBeVisible();
    await expect(page.getByText("Closing outstanding")).toBeVisible();
    await page.screenshot({ path: shot(`cash-flow-planner-${s.name}`), fullPage: true });
  });
}

test("a CONSERVATIVE scenario's assumptions round-trip across a tab switch (advisor-flagged: was write-only)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(Cash Flow Planner|Planner)/ }).first().click();
  await expect(page.getByRole("heading", { name: "Cash Flow Planner" })).toBeVisible();

  const code = `E2E${Date.now()}`;
  await page.getByPlaceholder("CONSERVATIVE / STRETCH / custom").fill(code);
  await page.getByRole("button", { name: "+ New scenario" }).click();
  await expect(page.getByRole("tab", { name: new RegExp(code) })).toBeVisible();

  const effInput = page.getByLabel("Collection efficiency %");
  await effInput.fill("55");
  await page.getByRole("button", { name: "Save assumptions" }).click();
  await expect(page.getByRole("button", { name: "Save assumptions" })).toBeVisible();

  // Switch to BASE and back — the panel must still show what was saved, not a blank field.
  await page.getByRole("tab", { name: /^BASE/ }).click();
  await page.getByRole("tab", { name: new RegExp(code) }).click();
  await expect(page.getByLabel("Collection efficiency %")).toHaveValue("55");
});

test("Collections Forecast lists real lines with a friendly booking number, not a raw id", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(Collections Forecast|Forecast)/ }).first().click();
  await expect(page.getByRole("heading", { name: "Collections Forecast" })).toBeVisible();
  // Pins forecast/core.ts's LINE_SELECT LEFT JOIN booking/unit — a future refactor that drops it
  // would silently regress to raw UUIDs, the exact bug this session mistook for a real defect
  // before finding it was only a stale dev server.
  await expect(page.getByText(/^BK-/).first()).toBeVisible();
  await page.screenshot({ path: shot("collections-forecast-desktop"), fullPage: true });
});

test("overriding a forecast line supersedes the old line and shows the new one", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(Collections Forecast|Forecast)/ }).first().click();
  await expect(page.getByRole("heading", { name: "Collections Forecast" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Override" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Override" }).first().click();
  await expect(page.getByRole("heading", { name: "Override forecast line" })).toBeVisible();
  await page.getByLabel("Reason (required)").fill("E2E override — pins the write path");
  await page.getByRole("button", { name: "Save override" }).click();
  await expect(page.getByRole("heading", { name: "Override forecast line" })).toHaveCount(0);
  await expect(page.locator("span").filter({ hasText: "Manual override" })).toBeVisible();
});

test("Portfolio Comparison lists East Crest and drills into its Cash Flow Planner", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /^Portfolio/ }).first().click();
  await expect(page.getByRole("heading", { name: "Portfolio Comparison" })).toBeVisible();
  const row = page.getByRole("row", { name: /East Crest/ });
  await expect(row).toBeVisible();
  await page.screenshot({ path: shot("portfolio-compare-desktop"), fullPage: true });

  await row.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Cash Flow Planner" })).toBeVisible();
});
