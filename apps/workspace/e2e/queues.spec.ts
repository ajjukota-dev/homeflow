import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 10-universal-action.md Screens: "Departmental queues" — targeted spec for this new surface at
// 3 breakpoints, not the full suite, per this session's standing guidance to keep e2e runs cheap
// between slices. Default storageState (playwright.config.ts) is superadmin, whose roles don't
// match any DEPARTMENTS entry, so the page deterministically defaults to the first tab (Sales).
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

// The tabpanel div itself is visible the instant it mounts, mid-fetch, showing the loading
// Skeleton — same bug class myday.spec.ts already hit ("screenshot captures the settled UI, not
// a one-frame loading skeleton"). Wait for the Skeleton to be gone, not just the panel to exist.
async function waitForSettled(page: import("@playwright/test").Page) {
  await expect(page.getByRole("tabpanel").locator(".animate-pulse")).toHaveCount(0);
}

for (const s of sizes) {
  test(`Queues @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: "Queues" }).first().click();
    await expect(page.getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
    await waitForSettled(page);
    await page.screenshot({ path: shot(`queues-${s.name}`), fullPage: true });
  });
}

test("Queues: row click opens the action drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Queues" }).first().click();
  await expect(page.getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
  await waitForSettled(page);

  // Try each department tab until one has an open row; some may be empty depending on prior
  // e2e/manual runs against this shared dev DB (same tolerant pattern as myday.spec.ts).
  const tabs = page.getByRole("tab");
  const tabCount = await tabs.count();
  for (let i = 0; i < tabCount; i++) {
    await tabs.nth(i).click();
    await waitForSettled(page);
    const row = page.getByRole("listitem").getByRole("button").first();
    if ((await row.count()) === 0) continue;
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.getByLabel("Close").click();
    await expect(dialog).toHaveCount(0);
    return;
  }
});
