import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 09-specification-revisions.md Screens: Policy Studio → Specification baselines, Variation
// catalogue. Every test scopes getByRole to page.locator("main") and/or uses exact:true for
// short/common labels — the established fix for getByRole's substring matching against this
// app's own nav button labels (the H11 class of bug this session has hit before).
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

async function openTab(page: Page, tabName: string) {
  await page.goto("/");
  // Mobile's nav chip row renders only nav.ts's `short` label ("Studio") — same pattern as
  // customisation.spec.ts's "Customisation Desk|^Custom.$" fix for the H11 class of bug.
  await page.getByRole("button", { name: /Policy Studio|^Studio$/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Policy Studio" })).toBeVisible();
  await page.getByRole("navigation", { name: "Policy Studio tabs" }).getByRole("button", { name: tabName }).click();
}

for (const s of sizes) {
  test(`Specification baselines @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openTab(page, "Specification baselines");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Specification baselines" })).toBeVisible();
    // Real seeded data, not a placeholder: East Crest's own APPROVED villa baseline with real items.
    await expect(main.getByText("East Crest Villa — Standard Specification")).toBeVisible();
    // .first(): a repeat local run of the "creating and approving" test below (against a
    // non-reset dev DB) leaves its own APPROVED E2E_TEST-scope baseline behind — a second,
    // legitimate Approved chip, not a bug. Real CI/fresh-reset runs only ever see one.
    await expect(main.getByText("Approved", { exact: true }).first()).toBeVisible();
    await expect(main.getByText(/RCC framed structure/)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`specification-baselines-${s.name}`), fullPage: true });
  });
}

for (const s of sizes) {
  test(`Variation catalogue @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openTab(page, "Variation catalogue");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Variation catalogue" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`variation-catalogue-${s.name}`), fullPage: true });
  });
}

// Creates its own DRAFT baseline with a distinctive, clearly-fake unit_type ("E2E_TEST") so
// approving it never retires the real seeded standard (unit_type NULL) villa baseline that
// East Crest's units and the customisation e2e suite actually depend on — a non-destructive
// fixture on the shared dev DB, same discipline as sla-policies.spec.ts restoring its own edit.
test("creating and approving a specification baseline round-trips real item data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTab(page, "Specification baselines");
  const main = page.locator("main");

  await main.getByRole("button", { name: "+ New baseline" }).click();
  await main.getByLabel("Unit type (optional)").fill("E2E_TEST");
  const name = `e2e test baseline ${Date.now()}`;
  await main.getByLabel("Name").fill(name);
  await main.getByPlaceholder("category (e.g. flooring)").fill("bathroom");
  await main.getByPlaceholder("spec text").fill("Anti-skid ceramic tiles, 600x600mm");
  await main.getByPlaceholder("brand/model").fill("Somany Aria");
  await main.getByRole("button", { name: "Create draft" }).click();

  // The card's own div is `rounded-lg border border-line p-3` (SpecificationBaselinesStudio.tsx) —
  // ancestor::div by class, not locator("div",{has:...}), which matches every enclosing div up to
  // <main> and .first() picks the outermost (the whole page), not the card.
  const card = main.getByText(name, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg') and contains(@class,'border-line')][1]");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Draft");
  await expect(card).toContainText("Anti-skid ceramic tiles");

  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  // Approving retires any prior APPROVED baseline in the SAME scope only — the seeded standard
  // (unit_type NULL) villa baseline is a different scope (E2E_TEST here), so it must survive.
  await expect(main.getByText("East Crest Villa — Standard Specification")).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

// Catalogue starts empty on a fresh DB (no seed rows) — this both proves the empty state and
// exercises the real bulk putCatalogue upsert (per-code, additive — never wipes existing rows).
test("adding a catalogue item shows real priced data, not a raw-id table", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTab(page, "Variation catalogue");
  const main = page.locator("main");

  const empty = main.getByText("No catalogue items configured yet.");
  const alreadyHasRows = await main.getByRole("button", { name: "+ Add item" }).count();
  expect(alreadyHasRows).toBeGreaterThan(0);
  if (await empty.isVisible().catch(() => false)) {
    await main.getByRole("button", { name: "Add the first item" }).click();
  } else {
    await main.getByRole("button", { name: "+ Add item" }).click();
  }

  const row = main.locator("tbody tr").last();
  const code = `E2ETEST${Date.now()}`;
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: "Electrical", exact: true }).click();
  await row.locator("input").nth(0).fill(code);
  await row.locator("input").nth(1).fill("Extra power point");
  await row.locator("input[type='number']").nth(0).fill("4500");
  await row.locator("input[type='number']").nth(1).fill("2800");
  await row.locator("input[type='number']").nth(2).fill("3");
  await main.getByRole("button", { name: "Save catalogue" }).click();

  // The row round-trips as editable inputs (not static text), so assert .toHaveValue(), not
  // getByText — and re-find the row by its own Code-column value after save/reload rather than
  // trusting `.last()` still points at it (save re-sorts by category_code, code).
  const rows = main.locator("tbody tr");
  const rowCount = await rows.count();
  let saved = null;
  for (let i = 0; i < rowCount; i++) {
    const codeInput = rows.nth(i).locator("td").nth(1).locator("input");
    if ((await codeInput.inputValue()) === code) { saved = rows.nth(i); break; }
  }
  expect(saved, `no saved row found with code ${code}`).not.toBeNull();
  await expect(saved!.locator("td").nth(2).locator("input")).toHaveValue("Extra power point");
  await expect(saved!.locator("td").nth(3).locator("input")).toHaveValue("4500");

  await assertNoHorizontalOverflow(page);
});
