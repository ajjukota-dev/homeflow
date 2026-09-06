import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

async function bookVilla(page: Page, applicant: string, phone: string, pan: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Sales/ }).first().click();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await page.getByRole("button", { name: "Book this villa" }).first().click();
  await expect(page.getByRole("heading", { name: /Book Villa/ })).toBeVisible();
  await page.getByPlaceholder("e.g. Anita Sharma").fill(applicant);
  await page.getByPlaceholder("10-digit mobile").fill(phone);
  await page.getByPlaceholder("ABCDE1234F").fill(pan);
  await page.getByPlaceholder(/00,000/).fill("8500000");
  await page.getByRole("checkbox").first().waitFor();
  for (const doc of await page.getByRole("checkbox").all()) await doc.click();
  await page.getByRole("button", { name: "Submit to CRM" }).click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
}

// 26-customer-portal.md Screens: "CRM → Customer updates queue (drafts from events, edit,
// publish)". A real booking.created event (18 §12 "booking + 24 h welcome") drafts a real
// customer_update row — this drives the actual flow end to end, not a seeded fixture, since the
// seed's bookings are inserted directly via SQL and never fire the event subscribers do.
test("a real booking drafts a welcome update, which CRM can edit and publish", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const applicant = "Kiran Update Test";
  await bookVilla(page, applicant, "9876500011", "UPDTK1234N");

  // Mobile header renders nav.ts's `short` label ("Updates") — the desktop sidebar uses the full
  // `label` ("Customer Updates"); the two share no common prefix (unlike sales-handover.spec.ts's
  // "Handover"/"Handover Packets"), so match both explicitly, anchored.
  await page.getByRole("button", { name: /^(Customer Updates|Updates)/ }).first().click();
  await expect(page.getByRole("heading", { name: "Customer updates" })).toBeVisible();
  await expect(page.getByText(new RegExp(`${applicant} · Villa`))).toBeVisible();
  await page.screenshot({ path: shot("customer-updates-draft-desktop"), fullPage: true });

  await page.getByLabel("Title").fill("Welcome aboard!");
  await page.getByRole("button", { name: "Publish to portal" }).click();
  await expect(page.getByText("No draft updates waiting for review.")).toBeVisible();
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
    await expect(page.getByText("No draft updates waiting for review.")).toBeVisible();
    await page.screenshot({ path: shot(`customer-updates-${s.name}`), fullPage: true });
  });
}
