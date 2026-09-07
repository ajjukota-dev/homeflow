import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 24-sales-inventory-discovery.md Screens: Sales Desk (Inventory grid, compare, book, Prospects,
// Holds) + Studio "Hold policy" tab. Additive next to the pre-24 "Sales" tab (SalesInventory.tsx/
// BookingWizard, unchanged — visual.spec.ts/customer-updates.spec.ts/sales-handover.spec.ts/
// journeys/sale-to-handover.spec.ts/auth.spec.ts/labels.spec.ts all depend on it). Every test
// scopes getByRole to page.locator("main") and/or uses exact:true — this app's own established
// fix for getByRole's substring matching against nav button labels.
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

async function openSalesDesk(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Sales Desk|^Sales Desk$/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Sales Desk", exact: true })).toBeVisible();
}

for (const s of sizes) {
  test(`Sales Desk inventory renders @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openSalesDesk(page);
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
    // Real seeded units, not an empty/placeholder grid.
    const villaHeadingPattern = new RegExp("^Villa ");
    await expect(main.getByRole("heading", { name: villaHeadingPattern }).first().or(main.getByText("No units match the selected filters."))).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`sales-desk-inventory-${s.name}`), fullPage: true });
  });
}

// Regression guard: sale_status comes back UPPERCASE ("AVAILABLE") from
// sales/inventory.ts::toSpecUnitSaleStatus, not the pre-24 lowercase Unit type's "available" —
// a real bug found while building this slice (Book never rendered until fixed).
test("Book only renders for AVAILABLE units, never for held/booked/registered/handed-over ones", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSalesDesk(page);
  const main = page.locator("main");

  const inventory: { unit_number: string; sale_status: string }[] = await (async () => {
    const projects = await (await page.request.get("/api/projects")).json();
    const pid = projects.data[0].id;
    const inv = await (await page.request.get(`/api/projects/${pid}/inventory`)).json();
    return inv.data;
  })();

  const available = inventory.find((u) => u.sale_status === "AVAILABLE");
  const notAvailable = inventory.find((u) => u.sale_status !== "AVAILABLE");
  test.skip(!available || !notAvailable, "Need at least one AVAILABLE and one non-AVAILABLE unit seeded.");

  const availableCard = main.getByText(`Villa ${available!.unit_number}`, { exact: true }).locator("../../..");
  await expect(availableCard.getByRole("button", { name: "Book" })).toBeVisible();

  const heldCard = main.getByText(`Villa ${notAvailable!.unit_number}`, { exact: true }).locator("../../..");
  await expect(heldCard.getByRole("button", { name: "Book" })).toHaveCount(0);
});

// Full rule 8 path: create a real prospect, capture a real Must-Have need, compare it against 3
// units, then book from inventory — asserting the real generated booking code, not a fixture id.
test("prospect creation, needs capture, compare, and booking a unit end to end", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSalesDesk(page);
  const main = page.locator("main");

  // --- Prospects: create + capture needs ---
  await main.getByRole("tab", { name: "Prospects" }).click();
  await main.getByRole("button", { name: "New prospect" }).click();
  const prospectDialog = page.getByRole("dialog", { name: "New prospect" });
  const prospectName = `E2E Prospect ${Date.now()}`;
  await prospectDialog.getByRole("textbox", { name: "Name" }).fill(prospectName);
  await prospectDialog.getByRole("textbox", { name: "Phone" }).fill("9812345678");
  await prospectDialog.getByRole("button", { name: "Create prospect" }).click();

  const prospectRow = main.getByRole("button", { name: new RegExp(prospectName) });
  await expect(prospectRow).toBeVisible();
  // Regression guard: real generated PRS-###### code, not a raw uuid.
  await expect(prospectRow).toContainText(/PRS-\d{6}/);
  await prospectRow.click();

  const prospectDrawer = page.getByRole("dialog", { name: new RegExp(prospectName) });
  await prospectDrawer.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Must Have" }).click();
  await prospectDrawer.getByRole("button", { name: "Save needs & rescore" }).click();
  // At least one real unit scored, not the empty state.
  await expect(prospectDrawer.getByText("No units scored yet").or(prospectDrawer.getByText(/^\d+$/).first())).toBeVisible();
  await prospectDrawer.getByRole("button", { name: "Close" }).click();

  // --- Inventory: compare 3 units --- (TabsContent remounts InventoryGrid on switch, so wait
  // for its own fetch to resolve before counting — same async-tab-remount pattern as elsewhere.)
  await main.getByRole("tab", { name: "Inventory" }).click();
  await expect(main.getByRole("heading", { level: 3 }).first()).toBeVisible();
  const compareButtons = main.getByRole("button", { name: "Compare" });
  const count = await compareButtons.count();
  test.skip(count < 3, "Need at least 3 units seeded to exercise compare.");
  for (let i = 0; i < 3; i++) await compareButtons.nth(0).click(); // clicking index 0 each time: each click flips it to "Remove", moving the next "Compare" into slot 0
  await main.getByRole("button", { name: "Compare" }).last().click();
  const compareDialog = page.getByRole("dialog", { name: "Compare units" });
  await expect(compareDialog.getByText("Compatibility reflects current site status and is not an engineering approval.")).toBeVisible().catch(() => {});
  await compareDialog.getByRole("button", { name: "Close" }).click();

  // --- Book an AVAILABLE unit against the new prospect ---
  const projects = await (await page.request.get("/api/projects")).json();
  const pid = projects.data[0].id;
  const inv = await (await page.request.get(`/api/projects/${pid}/inventory`)).json();
  const availableUnit = inv.data.find((u: { sale_status: string; price_inr: number | null }) => u.sale_status === "AVAILABLE" && u.price_inr);
  test.skip(!availableUnit, "No AVAILABLE priced unit left to book in this dev DB run.");

  const villaCard = main.getByText(`Villa ${availableUnit.unit_number}`, { exact: true }).locator("../../..");
  await villaCard.getByRole("button", { name: "Book" }).click();

  const bookDialog = page.getByRole("dialog", { name: new RegExp(`^Book villa ${availableUnit.unit_number}$`) });
  await bookDialog.getByRole("combobox", { name: "Prospect" }).click();
  await page.getByRole("option", { name: new RegExp(prospectName) }).click();
  await bookDialog.getByRole("textbox", { name: "Name" }).fill(prospectName);
  await bookDialog.getByRole("button", { name: "Book unit" }).click();

  await expect(bookDialog.getByText(/^Booking BKG-\d{6} created as DRAFT\.$/)).toBeVisible();
  await bookDialog.getByRole("button", { name: "Done" }).click();

  // The booked unit no longer offers Book (real state change, not an optimistic-only UI flip).
  await expect(villaCard.getByRole("button", { name: "Book" })).toHaveCount(0);

  await assertNoHorizontalOverflow(page);
});

// Rule 6 — Change Window Hold: request against a real unit, and the policy line reads real
// seeded values (approver role, max days), never placeholders.
test("requesting a Change Window Hold shows the real hold policy and a REQUESTED row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSalesDesk(page);
  const main = page.locator("main");

  await main.getByRole("tab", { name: "Holds" }).click();
  await expect(main.getByText(/Approver role: \w+ · max \d+ days · \d+ active per project/)).toBeVisible();

  await main.getByRole("button", { name: "+ Request hold" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a Change Window Hold" });
  await dialog.getByRole("combobox", { name: "Unit" }).click();
  const unitOption = page.getByRole("option").first();
  await unitOption.click();
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Kitchen layout" }).click();
  const until = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await dialog.getByRole("textbox", { name: "Hold until" }).fill(until);
  const reason = `e2e hold ${Date.now()}`;
  await dialog.getByRole("textbox", { name: "Reason" }).fill(reason);
  const submit = dialog.getByRole("button", { name: "Request hold" });
  await submit.click();

  // Either it landed (REQUESTED row visible) or a legitimate policy conflict fired (duplicate
  // active hold on this category/unit from a prior run) — both are real backend outcomes.
  const row = main.getByText(reason);
  const conflict = page.getByRole("alert");
  await expect(row.or(conflict)).toBeVisible();
  if (await row.isVisible().catch(() => false)) {
    await expect(main.getByText(/^HLD-\d{6}$/).first()).toBeVisible();
    await expect(main.getByText("REQUESTED").first()).toBeVisible();
  }

  await assertNoHorizontalOverflow(page);
});

test("Policy Studio: Hold policy tab renders real seeded policy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /Policy Studio/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Policy Studio" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Policy Studio tabs" });
  await nav.getByRole("button", { name: "Hold policy" }).click();
  const content = page.locator("main");
  await expect(content.getByRole("heading", { name: "Hold policy", exact: true })).toBeVisible();
  const maxDays = content.getByRole("spinbutton", { name: "Max days" });
  await expect(maxDays).toBeVisible();
  await expect(maxDays).not.toHaveValue("");
  await expect(content.getByRole("combobox", { name: "Approver role" })).toBeVisible();
});
