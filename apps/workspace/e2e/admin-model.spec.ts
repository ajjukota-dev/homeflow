import { test, expect } from "@playwright/test";

// Admin screens (04 §Screens): Projects (master + hierarchy), Units (bulk range create),
// Customers (search + merge preview). Screenshotted at 375/1440 per the task brief — note
// this is narrower than CLAUDE.md's usual 320/768/1024/1440 sweep for existing screens.
const shot = (name: string) => `e2e/__screenshots__/${name}.png`;
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

async function openAdmin(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Admin/ }).first().click();
  await expect(page.getByRole("radio", { name: "Projects" })).toBeVisible();
}

for (const s of sizes) {
  test(`Admin → Projects (master fields + hierarchy) @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openAdmin(page);
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByText("Master fields")).toBeVisible();
    await expect(page.getByText("Hierarchy")).toBeVisible();
    await page.screenshot({ path: shot(`admin-projects-${s.name}`), fullPage: true });
  });
}

test("Admin → Projects: add a hierarchy node", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page);
  await page.getByPlaceholder("Code, e.g. P2").fill("P2");
  await page.getByPlaceholder("Name, e.g. Phase 2").fill("Phase 2");
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(page.getByText("P2").first()).toBeVisible();
  await expect(page.getByText("Phase 2").first()).toBeVisible();
});

for (const s of sizes) {
  test(`Admin → Units (table + bulk range create) @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openAdmin(page);
    await page.getByRole("radio", { name: "Units" }).click();
    await expect(page.getByRole("heading", { name: "Units" })).toBeVisible();
    await expect(page.getByText("Bulk create from a range")).toBeVisible();
    await page.screenshot({ path: shot(`admin-units-${s.name}`), fullPage: true });
  });
}

test("Admin → Units: bulk range create adds rows to the table", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page);
  await page.getByRole("radio", { name: "Units" }).click();
  await expect(page.getByRole("heading", { name: "Units" })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  const before = await page.locator("table tbody tr").count();
  await page.getByRole("button", { name: "Create units" }).click();
  await expect(page.getByText(/Created \d+ units\./)).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(before + 1);
});

for (const s of sizes) {
  test(`Admin → Customers (search + merge preview) @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openAdmin(page);
    await page.getByRole("radio", { name: "Customers" }).click();
    await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
    await expect(page.getByText("Merge duplicate customers")).toBeVisible();
    await page.screenshot({ path: shot(`admin-customers-${s.name}`), fullPage: true });
  });
}

test("Admin → Customers: merge preview shows re-point count, then confirms", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page);
  await page.getByRole("radio", { name: "Customers" }).click();
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();

  await page.getByLabel("Merge from").selectOption({ label: "Karthik Iyer (9845011122)" });
  await page.getByLabel("Merge into").selectOption({ label: "Meera Krishnan (9845033344)" });
  await page.getByRole("button", { name: "Preview merge" }).click();
  await expect(page.getByText(/booking\(s\) will re-point/)).toBeVisible();

  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText(/Merged — history preserved/)).toBeVisible();
});
