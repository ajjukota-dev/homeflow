import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 07-unit-progress-control.md Screens: "Project Unit Status Console" — grid units x components,
// filters, bulk-update drawer with gate-delta preview, reopen (regression) requires a reason.
// Every test scopes getByRole to page.locator("main") and/or uses exact:true for short/common
// labels — the H11-class fix for getByRole's substring matching against this app's own nav.
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

async function assertNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function openConsole(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Project \/ Site|^Site$/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Unit Progress Control", exact: true })).toBeVisible();
  await page.locator("main").getByRole("tab", { name: "Console", exact: true }).click();
}

async function createFixtureUnit(page: Page, hierarchyNodeId?: string): Promise<{ id: string; unit_number: string }> {
  const unitNumber = `E2E${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`;
  const res = await page.request.post("/api/projects/p_eastcrest/units", {
    data: { unit_number: unitNumber, unit_type: "3BHK", facing: "North", hierarchy_node_id: hierarchyNodeId },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { id: body.data.id, unit_number: unitNumber };
}

// A dedicated PHASE node so the bulk-scope test below sees exactly its own fixture units — the
// project's real "Ungrouped units" default node accumulates unrelated seeded/fixture units over
// a dev server's lifetime, which would make a scope-by-node preview non-deterministic.
async function createFixtureNode(page: Page): Promise<{ id: string; name: string }> {
  const code = `E2E${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`;
  const name = `E2E fixture phase ${code}`;
  const res = await page.request.post("/api/projects/p_eastcrest/hierarchy", {
    data: { kind: "PHASE", code, name },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { id: body.data.id, name };
}

for (const s of sizes) {
  test(`Unit Progress Console renders @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openConsole(page);
    const main = page.locator("main");
    // Mobile is a unit list (tap a unit for its checklist); tablet/desktop show the grid table —
    // both real, seeded units (1A/V10x), not the (hidden until opened) filter <select> options.
    if (s.width < 768) {
      await expect(main.getByRole("button", { name: /^(1A|V\d+)$/ }).first()).toBeVisible();
    } else {
      await expect(main.locator("table tbody tr").first()).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`progress-console-${s.name}`), fullPage: true });
  });
}

// Rule 3/4: regressing a declared/verified cell requires a reason; COMPLETE/VERIFIED are role-gated
// server-side (assertStateAuthority) but SUPER_ADMIN (this suite's default storageState) bypasses
// that, so this walks the full state machine on one isolated fixture unit.
test("editing a cell enforces a reason when regressing from Complete, and updates otherwise", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const unit = await createFixtureUnit(page);
  await openConsole(page);

  const main = page.locator("main");
  const row = main.locator("tr", { hasText: unit.unit_number });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Not started" }).first().click();

  const dialog = page.getByRole("dialog", { name: new RegExp(`Structure / RCC — ${unit.unit_number}`) });
  await dialog.getByLabel("State").selectOption("COMPLETE");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Complete" }).first()).toBeVisible();

  // Regress Complete -> Not started without a reason: blocked client-side.
  await row.getByRole("button", { name: "Complete" }).first().click();
  const dialog2 = page.getByRole("dialog", { name: new RegExp(`Structure / RCC — ${unit.unit_number}`) });
  await dialog2.getByLabel("State").selectOption("NOT_STARTED");
  await dialog2.getByRole("button", { name: "Save" }).click();
  await expect(dialog2.getByText(/needs a reason/)).toBeVisible();

  // Add a reason: the regression goes through and progress_reopen/progress.reopened fire server-side.
  await dialog2.getByLabel(/Reason \(required/).fill("E2E: reverting fixture cell after test assertion");
  await dialog2.getByRole("button", { name: "Save" }).click();
  await expect(dialog2).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Not started" }).first()).toBeVisible();

  const history = await (await page.request.get(`/api/units/${unit.id}/progress/history`)).json();
  expect(history.data.some((h: { type: string }) => h.type === "progress.reopened")).toBe(true);
});

// Rule 5: two-step bulk update — preview (with gate deltas) before commit; excluding a regressing
// unit with its own reason lets the rest of the batch apply without a top-level reason.
test("bulk update previews gate deltas and lets a regressing unit be excluded with its own reason", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const node = await createFixtureNode(page);
  const toRaise = await createFixtureUnit(page, node.id);
  const alreadyVerified = await createFixtureUnit(page, node.id);
  // Bring alreadyVerified's structure cell to VERIFIED directly via the API so the bulk update
  // below has a real regression to exclude.
  await page.request.put(`/api/units/${alreadyVerified.id}/progress/structure`, { data: { state_code: "COMPLETE" } });
  await page.request.put(`/api/units/${alreadyVerified.id}/progress/structure`, { data: { state_code: "VERIFIED" } });

  await openConsole(page);
  const main = page.locator("main");
  await main.getByRole("button", { name: "Bulk update" }).click();
  const drawer = page.getByRole("dialog", { name: "Bulk update progress" });
  await drawer.getByRole("checkbox", { name: new RegExp(node.name) }).check();
  await drawer.getByLabel("Component").selectOption("structure");
  await drawer.getByLabel("New state").selectOption("COMPLETE");
  await drawer.getByRole("button", { name: "Preview" }).click();

  const raiseRow = drawer.locator("tr", { hasText: toRaise.unit_number });
  const regressRow = drawer.locator("tr", { hasText: alreadyVerified.unit_number });
  await expect(raiseRow).toBeVisible();
  await expect(regressRow).toBeVisible();
  await expect(regressRow.getByText("regression")).toBeVisible();

  await regressRow.getByPlaceholder("reason to exclude").fill("E2E: keep verified fixture untouched");
  await drawer.getByRole("button", { name: /^Apply to \d+ units$/ }).click();
  await expect(drawer).toHaveCount(0);

  const toRaiseRow = main.locator("tr", { hasText: toRaise.unit_number });
  await expect(toRaiseRow.getByRole("button", { name: "Complete" }).first()).toBeVisible();
  const stillVerifiedRow = main.locator("tr", { hasText: alreadyVerified.unit_number });
  await expect(stillVerifiedRow.getByRole("button", { name: "Verified" }).first()).toBeVisible();
});

// MANAGEMENT has real READ (not WRITE) on unit_readiness (seed/permissions.ts matrix) — the console
// must render every cell read-only, with no Bulk update entry point, on both tabs.
test("MANAGEMENT sees the console read-only — no clickable cells, no bulk update", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByLabel("Email").fill("management@demo.pranava");
  await page.getByLabel("Password").fill("Demo@2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Control tower" })).toBeVisible();
  await openConsole(page);

  const main = page.locator("main");
  await expect(main.getByRole("button", { name: "Bulk update" })).toHaveCount(0);
  await expect(main.locator("table button")).toHaveCount(0);

  await main.getByRole("tab", { name: "By villa", exact: true }).click();
  await expect(main.getByRole("radiogroup")).toHaveCount(0);
  await ctx.close();
});
