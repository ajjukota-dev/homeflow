import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 23-registration.md Screens: "Registration (Registration role)". Every test scopes getByRole to
// page.locator("main") and/or uses exact:true for short/common labels — the established fix for
// getByRole's substring matching against this app's own nav button labels (the H11 class of bug
// this session hit repeatedly). SUPER_ADMIN's default storageState reaches the "legal" nav entry
// (roles: LEGAL/REGISTRATION/MANAGEMENT/SUPER_ADMIN), so no per-role login is needed here.
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

async function openRegistrationDesk(page: Page) {
  await page.goto("/");
  // Desktop's nav button carries the full "Legal Documents & registration" accessible name
  // (label + description); mobile's chip row renders only nav.ts's short label ("Legal") — same
  // H11-class fix as specification-studio.spec.ts's own openTab helper.
  await page.getByRole("button", { name: /Legal Documents|^Legal$/ }).first().click();
  await page.getByRole("tab", { name: "Registration Desk" }).click();
  await expect(page.locator("main").getByRole("heading", { name: "Registration" })).toBeVisible();
  // Wait past the loading skeleton — bookings/pipeline fetch resolves async, so a screenshot or
  // a "Not started" check taken right after the tab click can race an empty first paint.
  await page.waitForLoadState("networkidle");
}

for (const s of sizes) {
  test(`Registration desk pipeline @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openRegistrationDesk(page);
    const main = page.locator("main");
    await expect(main.getByText("Readiness, SRO scheduling and execution")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`registration-desk-${s.name}`), fullPage: true });
  });
}

// Lazy case creation (core.ts's loadOrCreateCase) — the pipeline only lists bookings that already
// have a registration_case row, so a booking must first appear under "Not started" and be opened
// from there. This exercises that real bootstrap path end to end, not a pre-seeded fixture.
test("opening a not-started booking lazily creates its case and shows the readiness card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRegistrationDesk(page);
  const main = page.locator("main");

  const notStarted = main.getByRole("heading", { name: "Not started" });
  if (!(await notStarted.isVisible().catch(() => false))) {
    test.skip(true, "every booking in this project already has a registration case (not a fresh reset)");
  }

  const firstOpenButton = main.getByRole("button", { name: /Open registration/ }).first();
  const label = await firstOpenButton.innerText();
  await firstOpenButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/^REG-\d{6}$/)).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Readiness (7 gate READY; availability is separate)" })).toBeVisible();
  // All 8 facts render (7 hard + the separate availability line), never a raw booking/unit id.
  await expect(dialog.getByText("Customer documents:")).toBeVisible();
  await expect(dialog.getByText("Customer availability (not a READY gate):")).toBeVisible();
  await expect(dialog).not.toContainText(/\bbk_[a-z0-9]+\b/);
  await expect(dialog).not.toContainText(/\bu_[a-z0-9]+\b/);

  await page.getByRole("button", { name: "Close" }).click();
  await expect(main.getByRole("button", { name: label, exact: true })).toHaveCount(0);
});

for (const s of sizes) {
  test(`Policy Studio: Registration checklists and SRO offices tabs render real seeded scope data @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /Policy Studio|^Studio$/ }).first().click();
    await expect(page.locator("main").getByRole("heading", { name: "Policy Studio" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Policy Studio tabs" });

    await nav.getByRole("button", { name: "Registration checklists" }).click();
    const checklistMain = page.locator("main");
    await expect(checklistMain.getByRole("heading", { name: "Registration checklists" })).toBeVisible();
    // Global default scope ships with real seeded day-of items (23's own Build note) — proves the
    // Select's onValueChange-only load bug (found live) stays fixed: the form populates on first paint.
    await expect(checklistMain.locator('input[value="originals_to_carry"]')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`registration-checklist-studio-${s.name}`), fullPage: true });

    await nav.getByRole("button", { name: "SRO offices" }).click();
    await expect(checklistMain.getByRole("heading", { name: "SRO offices", exact: true })).toBeVisible();
    await expect(checklistMain.getByLabel("Jurisdiction lead days (added to the forecast date)")).toHaveValue("15");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`sro-offices-studio-${s.name}`), fullPage: true });
  });
}

// Non-destructive: adds then removes its own office so the shared dev DB's global scope is left
// as this test found it (same discipline as sla-policies.spec.ts / specification-studio.spec.ts).
test("SRO offices: adding an office makes it available in the Registration desk's slot picker", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const officeName = `E2E Test SRO ${Date.now()}`;

  await page.goto("/");
  await page.getByRole("button", { name: /Policy Studio|^Studio$/ }).first().click();
  await page.getByRole("navigation", { name: "Policy Studio tabs" }).getByRole("button", { name: "SRO offices" }).click();
  const studioMain = page.locator("main");
  await expect(studioMain.getByRole("heading", { name: "SRO offices", exact: true })).toBeVisible();
  // The heading renders synchronously; the office list itself only populates once
  // listChecklistTemplates() resolves — wait past that before reading a row count, or `before`
  // races the fetch and undercounts real pre-existing rows.
  await page.waitForLoadState("networkidle");

  // `data-testid="sro-office-row"` (SroOfficesStudio.tsx) — a plain class selector here
  // (`div.flex.items-center.gap-2`) also matched PageHeader's own unrelated actions wrapper,
  // which carries the same three classes; a dedicated test id avoids that collision entirely.
  const officeRows = studioMain.getByTestId("sro-office-row");
  const before = await officeRows.count();

  await studioMain.getByRole("button", { name: "+ Add office" }).click();
  await officeRows.last().locator("input").fill(officeName);
  await studioMain.getByRole("button", { name: "Save" }).click();
  await expect(studioMain.locator(`input[value="${officeName}"]`)).toBeVisible();
  expect(await officeRows.count()).toBe(before + 1);

  // Undo — remove the office and save again so the scope reverts to what this test found.
  await officeRows.last().getByRole("button").click();
  // Wait for the row's own local-state removal to actually commit before Save reads `offices` —
  // otherwise Save can fire on the same tick as the delete click and persist the pre-delete list.
  await expect(studioMain.locator(`input[value="${officeName}"]`)).toHaveCount(0);
  await studioMain.getByRole("button", { name: "Save" }).click();
  await expect(studioMain.locator(`input[value="${officeName}"]`)).toHaveCount(0);
  expect(await officeRows.count()).toBe(before);
});
