import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

const SPARE = new Set(["V101", "V104", "V108"]);

async function bookFromSalesDesk(page: Page, applicant: string, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Sales Desk/ }).first().click();
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Sales Desk", exact: true })).toBeVisible();

  await main.getByRole("tab", { name: "Prospects" }).click();
  await main.getByRole("button", { name: "New prospect" }).click();
  const prospectDialog = page.getByRole("dialog", { name: "New prospect" });
  await prospectDialog.getByRole("textbox", { name: "Name" }).fill(applicant);
  await prospectDialog.getByRole("textbox", { name: "Phone" }).fill(phone);
  await prospectDialog.getByRole("button", { name: "Create prospect" }).click();
  await expect(main.getByRole("button", { name: new RegExp(applicant) }).first()).toBeVisible();

  await main.getByRole("tab", { name: "Inventory" }).click();
  const projects = await (await page.request.get("/api/projects")).json();
  const pid = projects.data[0].id;
  const inv = await (await page.request.get(`/api/projects/${pid}/inventory`)).json();
  const list = inv.data as { sale_status: string; unit_number: string; price_inr: number | null }[];
  const availableUnit =
    list.find((u) => u.sale_status === "AVAILABLE" && u.price_inr && SPARE.has(u.unit_number)) ??
    list.find((u) => u.sale_status === "AVAILABLE" && u.price_inr);
  if (!availableUnit) throw new Error("No AVAILABLE unit to book");

  const villaCard = main.getByText(`Villa ${availableUnit.unit_number}`, { exact: true }).locator("../../..");
  await villaCard.getByRole("button", { name: "Book", exact: true }).click();
  const bookDialog = page.getByRole("dialog", { name: new RegExp(`^Book villa ${availableUnit.unit_number}$`) });
  await bookDialog.getByRole("combobox", { name: "Prospect" }).click();
  await page.getByRole("option", { name: new RegExp(applicant) }).click();
  await bookDialog.getByRole("textbox", { name: "Name" }).fill(applicant);
  await bookDialog.getByRole("button", { name: "Book unit", exact: true }).click();
  await expect(bookDialog.getByText(/Booking BKG-\d+ created as DRAFT/)).toBeVisible();
  await bookDialog.getByRole("button", { name: "Done" }).click();
}

// 26-customer-portal.md Screens: "CRM → Customer updates queue (drafts from events, edit,
// publish)". A real booking.created event (18 §12 "booking + 24 h welcome") drafts a real
// customer_update row — this drives the actual flow end to end, not a seeded fixture, since the
// seed's bookings are inserted directly via SQL and never fire the event subscribers do.
test("a real booking drafts a welcome update, which CRM can edit and publish", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const applicant = `Kiran Update ${Date.now()}`;
  await bookFromSalesDesk(page, applicant, "9876500011");

  // Mobile header renders nav.ts's `short` label ("Updates") — the desktop sidebar uses the full
  // `label` ("Customer Updates"); the two share no common prefix (unlike sales-handover.spec.ts's
  // "Handover"/"Handover Packets"), so match both explicitly, anchored.
  await page.getByRole("button", { name: /^(Customer Updates|Updates)/ }).first().click();
  await expect(page.getByRole("heading", { name: "Customer updates" })).toBeVisible();
  await expect(page.getByText(new RegExp(`${applicant} · Villa`))).toBeVisible();
  await page.screenshot({ path: shot("customer-updates-draft-desktop"), fullPage: true });

  const card = page.locator("main").locator("div.rounded-card").filter({ hasText: `${applicant} · Villa` }).first();
  await card.getByLabel("Title").fill("Welcome aboard!");
  await card.getByRole("button", { name: "Publish to portal" }).click();
  await expect(page.getByText(new RegExp(`${applicant} · Villa`))).toHaveCount(0);
});

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
// Runs after the main flow test above, which publishes its only draft — the queue is genuinely
// empty by now, same precedent as sales-handover.spec.ts's size-loop tests reusing prior state.
for (const s of sizes) {
  test(`Customer Updates queue empty state @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    // Mobile header renders nav.ts's `short` label ("Updates") — the desktop sidebar uses the
    // full `label` ("Customer Updates"); the two share no common prefix (unlike
    // sales-handover.spec.ts's "Handover"/"Handover Packets"), so match both explicitly, anchored.
    await page.getByRole("button", { name: /^(Customer Updates|Updates)/ }).first().click();
    await expect(page.getByRole("heading", { name: "Customer updates" })).toBeVisible();
    await page.screenshot({ path: shot(`customer-updates-${s.name}`), fullPage: true });
  });
}
