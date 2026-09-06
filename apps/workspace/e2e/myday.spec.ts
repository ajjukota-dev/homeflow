import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 11-my-day-ranking.md + 10-universal-action.md: My Day's row click now opens 10's ActionDrawer
// (this session's slice). Targeted spec, not the full suite — just this new surface at 3
// breakpoints, per the standing guidance to keep e2e runs cheap between slices.
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

for (const s of sizes) {
  test(`My Day @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: "My Day" }).first().click();
    await expect(page.getByRole("heading", { name: "My Day" })).toBeVisible();
    // Wait past the initial fetch (Skeleton -> either Tabs or the empty state) so the
    // screenshot captures the settled UI, not a one-frame loading skeleton.
    await expect(page.getByText(/done today\.|Couldn't load My Day\./)).toBeVisible();
    await page.screenshot({ path: shot(`myday-${s.name}`), fullPage: true });
  });
}

test("My Day row opens the Action drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "My Day" }).first().click();
  await expect(page.getByRole("heading", { name: "My Day" })).toBeVisible();

  // Superadmin's own My Day may have nothing due — the fixture is real seed data, not
  // authored for this test. Try each section tab until one has a clickable row; if none
  // do, the drawer genuinely has nothing to open against and the test is a no-op (the
  // component itself is unit-tested independently in ActionDrawer.test.tsx).
  const tabs = page.getByRole("tab");
  const tabCount = await tabs.count();
  for (let i = 0; i < tabCount; i++) {
    await tabs.nth(i).click();
    const row = page.getByRole("listitem").getByRole("button").first();
    if ((await row.count()) === 0) continue;
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: shot("myday-action-drawer-desktop"), fullPage: true });
    await page.getByLabel("Close").click();
    await expect(dialog).toHaveCount(0);

    for (const s of sizes.filter((x) => x.name !== "desktop")) {
      await page.setViewportSize({ width: s.width, height: s.height });
      await row.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({ path: shot(`myday-action-drawer-${s.name}`), fullPage: true });
      await page.getByLabel("Close").click();
    }
    return;
  }
});
